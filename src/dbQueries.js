import { saveDbToBrowser } from './dbStorage.js';

const SETTINGS_KEYS = {
  excludedCategoryKeywords: 'excluded_category_keywords',
  excludedDescriptionKeywords: 'excluded_description_keywords',
  reimbursementExcludedCategories: 'reimbursement_excluded_categories',
};

const DEFAULT_ANALYTICS_SETTINGS = {
  [SETTINGS_KEYS.excludedCategoryKeywords]: ['transfer', 'saving'],
  [SETTINGS_KEYS.excludedDescriptionKeywords]: ['bill payment', 'payment thank you', 'electronic payment'],
  [SETTINGS_KEYS.reimbursementExcludedCategories]: ['income', 'transfers', 'transfer', 'credit card payment'],
};

const REQUIRED_COLUMNS = {
  manual_override: 'INTEGER',
  dedupe_group_key: 'TEXT',
  dedupe_source_amount: 'REAL',
  dedupe_source_date: 'TEXT',
  split_parent_id: 'INTEGER',
  is_hidden: 'INTEGER DEFAULT 0',
};

const rowify = (execResult) => {
  if (!execResult || execResult.length === 0) return [];
  const { columns = [], values = [] } = execResult[0] || {};
  return values.map((row) => {
    const mapped = {};
    columns.forEach((column, index) => {
      mapped[column] = row[index];
    });
    return mapped;
  });
};

const scalar = async (db, sql, fallback = 0) => {
  const rows = rowify(await db.exec(sql));
  if (!rows.length) return fallback;
  const value = rows[0][Object.keys(rows[0])[0]];
  return value ?? fallback;
};

const sqlValue = (value) => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  return `'${String(value).replace(/'/g, "''")}'`;
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const round2 = (value) => Math.round(toNumber(value) * 100) / 100;

const randomKey = (prefix) => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const normalizeText = (value) => String(value ?? '').trim();

const normalizeLower = (value) => normalizeText(value).toLowerCase();

const normalizeStringList = (values) => {
  if (!Array.isArray(values)) return [];

  const seen = new Set();
  const normalized = [];

  for (const item of values) {
    const value = normalizeLower(item);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }

  return normalized;
};

const parseArraySettingValue = (rawValue, fallback) => {
  const parsedFallback = normalizeStringList(fallback);

  try {
    const parsed = JSON.parse(String(rawValue ?? ''));
    const normalized = normalizeStringList(parsed);
    return normalized.length > 0 ? normalized : parsedFallback;
  } catch {
    return parsedFallback;
  }
};

const buildLikeConditionSql = (columnSql, keywords, negate = false) => {
  const normalized = normalizeStringList(keywords);
  if (normalized.length === 0) {
    return negate ? '1 = 1' : '1 = 0';
  }

  const operator = negate ? 'NOT LIKE' : 'LIKE';
  const joiner = negate ? ' AND ' : ' OR ';
  return normalized
    .map((keyword) => `${columnSql} ${operator} ${sqlValue(`%${keyword}%`)}`)
    .join(joiner);
};

const buildNotInListSql = (values) => {
  const normalized = normalizeStringList(values);
  if (normalized.length === 0) {
    return "('income')";
  }

  return `(${normalized.map((value) => sqlValue(value)).join(', ')})`;
};

const getAnalyticsSettings = async (db) => {
  const defaults = DEFAULT_ANALYTICS_SETTINGS;

  const rows = rowify(await db.exec(`
    SELECT key, value
    FROM app_settings
    WHERE key IN (
      ${sqlValue(SETTINGS_KEYS.excludedCategoryKeywords)},
      ${sqlValue(SETTINGS_KEYS.excludedDescriptionKeywords)},
      ${sqlValue(SETTINGS_KEYS.reimbursementExcludedCategories)}
    );
  `));

  const byKey = new Map(rows.map((row) => [String(row.key), row.value]));

  const excludedCategoryKeywords = parseArraySettingValue(
    byKey.get(SETTINGS_KEYS.excludedCategoryKeywords),
    defaults[SETTINGS_KEYS.excludedCategoryKeywords],
  );

  const excludedDescriptionKeywords = parseArraySettingValue(
    byKey.get(SETTINGS_KEYS.excludedDescriptionKeywords),
    defaults[SETTINGS_KEYS.excludedDescriptionKeywords],
  );

  const reimbursementExcludedCategories = parseArraySettingValue(
    byKey.get(SETTINGS_KEYS.reimbursementExcludedCategories),
    defaults[SETTINGS_KEYS.reimbursementExcludedCategories],
  );

  if (!reimbursementExcludedCategories.includes('income')) {
    reimbursementExcludedCategories.unshift('income');
  }

  return {
    excludedCategoryKeywords,
    excludedDescriptionKeywords,
    reimbursementExcludedCategories,
  };
};

const getAnalyticsSqlFragments = async (db) => {
  const settings = await getAnalyticsSettings(db);

  const categoryExcludedSql = buildLikeConditionSql(
    "COALESCE(LOWER(category), '')",
    settings.excludedCategoryKeywords,
    false,
  );

  const descriptionExcludedSql = buildLikeConditionSql(
    "COALESCE(LOWER(description), '')",
    settings.excludedDescriptionKeywords,
    false,
  );

  const categoryIncludedSql = buildLikeConditionSql(
    "COALESCE(LOWER(category), '')",
    settings.excludedCategoryKeywords,
    true,
  );

  const descriptionIncludedSql = buildLikeConditionSql(
    "COALESCE(LOWER(description), '')",
    settings.excludedDescriptionKeywords,
    true,
  );

  const excludedPatternSql = `(${categoryExcludedSql} OR ${descriptionExcludedSql})`;
  const includedConditionSql = `(
    manual_override = 0 OR (
      manual_override IS NULL AND
      ${categoryIncludedSql} AND
      ${descriptionIncludedSql}
    )
  )`;

  const reimbursementExcludedCategoriesSql = buildNotInListSql(settings.reimbursementExcludedCategories);

  return {
    excludedPatternSql,
    includedConditionSql,
    reimbursementExcludedCategoriesSql,
  };
};

const serializeStringListSetting = (values, fallbackValues = []) => {
  const normalized = normalizeStringList(values);
  const fallback = normalizeStringList(fallbackValues);
  const finalValues = normalized.length > 0 ? normalized : fallback;
  return JSON.stringify(finalValues);
};

const toRule = (row) => ({
  id: Number(row.id),
  name: normalizeText(row.name),
  priority: Number(row.priority ?? 0),
  match_column: normalizeText(row.match_column),
  match_operator: normalizeText(row.match_operator),
  match_value: normalizeText(row.match_value),
  action_type: normalizeText(row.action_type),
  action_payload: row.action_payload ?? '',
  is_active: Boolean(Number(row.is_active ?? 0)),
});

const normalizeRuleActionType = (value) => normalizeLower(value);

const normalizeRuleMatchOperator = (value) => normalizeLower(value);

const serializeRulePayload = (actionType, actionPayload) => {
  if (normalizeRuleActionType(actionType) === 'split') {
    if (typeof actionPayload === 'string') return actionPayload;
    return JSON.stringify(actionPayload ?? { splits: [] });
  }

  if (actionPayload === null || actionPayload === undefined) return '';
  return String(actionPayload);
};

const parseSplitDefinitions = (actionPayload, parentAmount) => {
  let parsedPayload = actionPayload;
  if (typeof parsedPayload === 'string') {
    parsedPayload = JSON.parse(parsedPayload);
  }

  const splits = Array.isArray(parsedPayload)
    ? parsedPayload
    : parsedPayload?.splits;

  if (!Array.isArray(splits) || splits.length < 2) {
    throw new Error('Split rules require at least two split lines.');
  }

  const normalizedSplits = splits.map((line) => {
    const category = normalizeText(line?.category);
    const description = normalizeText(line?.description);
    const amount = round2(toNumber(line?.amount, NaN));

    if (!category) {
      throw new Error('Each split line must include a category.');
    }

    if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) {
      throw new Error('Split amounts must be non-zero.');
    }

    return {
      category,
      description,
      amount,
    };
  });

  const splitTotal = round2(normalizedSplits.reduce((sum, line) => sum + line.amount, 0));
  const parentTotal = round2(toNumber(parentAmount));
  if (Math.abs(splitTotal - parentTotal) > 0.01) {
    throw new Error(`Split amounts must sum to ${parentTotal.toFixed(2)}. Received ${splitTotal.toFixed(2)}.`);
  }

  return normalizedSplits;
};

const ruleMatchesTransaction = (transaction, rule) => {
  const matchColumn = normalizeText(rule.match_column);
  if (!matchColumn) return false;

  const needle = normalizeLower(rule.match_value);
  if (!needle) return false;

  const haystack = normalizeLower(transaction?.[matchColumn]);
  const operator = normalizeRuleMatchOperator(rule.match_operator);

  if (operator === 'contains') {
    return haystack.includes(needle);
  }

  if (operator === 'equals') {
    return haystack === needle;
  }

  if (operator === 'starts with') {
    return haystack.startsWith(needle);
  }

  return false;
};

const buildSplitChildRow = (parentRow, split, splitParentId = null) => ({
  date: parentRow.date,
  description: split.description || parentRow.description,
  amount: split.amount,
  account: parentRow.account,
  category: split.category,
  source_file: parentRow.source_file,
  manual_override: parentRow.manual_override,
  dedupe_group_key: parentRow.dedupe_group_key || randomKey('split'),
  dedupe_source_amount: parentRow.dedupe_source_amount ?? parentRow.amount,
  dedupe_source_date: parentRow.dedupe_source_date || parentRow.date,
  split_parent_id: splitParentId,
  is_hidden: 0,
});

const applyRulesToImportedTransaction = (transaction, rules = []) => {
  let current = { ...transaction };

  for (const rule of rules) {
    if (!rule.is_active) continue;
    if (!ruleMatchesTransaction(current, rule)) continue;

    const actionType = normalizeRuleActionType(rule.action_type);

    if (actionType === 'categorize') {
      const nextCategory = normalizeText(rule.action_payload);
      if (nextCategory) {
        current = {
          ...current,
          category: nextCategory,
        };
      }
      continue;
    }

    if (actionType === 'split') {
      const splits = parseSplitDefinitions(rule.action_payload, current.amount);
      const dedupeGroupKey = current.dedupe_group_key || randomKey('split');
      const dedupeSourceAmount = current.dedupe_source_amount ?? current.amount;
      const dedupeSourceDate = current.dedupe_source_date || current.date;

      const parent = {
        ...current,
        is_hidden: 1,
        dedupe_group_key: dedupeGroupKey,
        dedupe_source_amount: dedupeSourceAmount,
        dedupe_source_date: dedupeSourceDate,
        split_parent_id: null,
      };

      return {
        kind: 'split',
        parent,
        children: splits.map((split) => buildSplitChildRow(parent, split)),
      };
    }
  }

  return {
    kind: 'single',
    transaction: current,
  };
};

const buildRuleInsertValues = (rule) => ({
  name: normalizeText(rule.name),
  priority: toNumber(rule.priority, 0),
  match_column: normalizeText(rule.match_column),
  match_operator: normalizeText(rule.match_operator),
  match_value: normalizeText(rule.match_value),
  action_type: normalizeText(rule.action_type),
  action_payload: serializeRulePayload(rule.action_type, rule.action_payload),
  is_active: rule.is_active === undefined ? 1 : Number(Boolean(rule.is_active)),
});

const buildRuleUpdateValues = (rule) => ({
  ...buildRuleInsertValues(rule),
  id: Number(rule.id),
});

const ensureRulesTableSchema = async (db) => {
  const requiredRuleColumns = [
    'id',
    'name',
    'priority',
    'match_column',
    'match_operator',
    'match_value',
    'action_type',
    'action_payload',
    'is_active',
  ];

  const ruleTableInfo = rowify(await db.exec('PRAGMA table_info(rules);'));
  const ruleColumns = new Set(ruleTableInfo.map((col) => String(col.name)));
  const isSchemaComplete = requiredRuleColumns.every((columnName) => ruleColumns.has(columnName));

  if (isSchemaComplete) {
    return;
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS rules_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      priority INTEGER DEFAULT 0,
      match_column TEXT,
      match_operator TEXT,
      match_value TEXT,
      action_type TEXT,
      action_payload TEXT,
      is_active INTEGER DEFAULT 1
    );
  `);

  if (ruleColumns.size > 0) {
    const hasColumn = (columnName) => ruleColumns.has(columnName);
    const selectColumns = [
      'id',
      hasColumn('name') ? 'name' : "'Unnamed Rule ' || id AS name",
      hasColumn('priority') ? 'priority' : '0 AS priority',
      hasColumn('match_column') ? "COALESCE(match_column, 'description') AS match_column" : "'description' AS match_column",
      hasColumn('match_operator') ? "COALESCE(match_operator, 'contains') AS match_operator" : "'contains' AS match_operator",
      hasColumn('match_value') ? "COALESCE(match_value, '') AS match_value" : "'' AS match_value",
      hasColumn('action_type') ? "COALESCE(action_type, 'categorize') AS action_type" : "'categorize' AS action_type",
      hasColumn('action_payload') ? "COALESCE(action_payload, '') AS action_payload" : "'' AS action_payload",
      hasColumn('is_active') ? 'COALESCE(is_active, 1) AS is_active' : '1 AS is_active',
    ];

    await db.exec(`
      INSERT INTO rules_new (${requiredRuleColumns.join(', ')})
      SELECT ${selectColumns.join(', ')}
      FROM rules;
    `);
  }

  await db.exec(`DROP TABLE IF EXISTS rules;`);
  await db.exec(`ALTER TABLE rules_new RENAME TO rules;`);
};

const toTransaction = (row) => {
  const manualOverride = row.manual_override === null || row.manual_override === undefined
    ? null
    : Number(row.manual_override);

  const splitParentId = row.split_parent_id === null || row.split_parent_id === undefined
    ? null
    : Number(row.split_parent_id);

  return {
    ...row,
    id: Number(row.id),
    amount: toNumber(row.amount),
    manual_override: manualOverride,
    split_parent_id: splitParentId,
    is_split: splitParentId !== null,
    is_excluded: Boolean(Number(row.is_excluded)),
  };
};

export async function bootstrapSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      description TEXT,
      amount REAL,
      account TEXT,
      category TEXT,
      source_file TEXT,
      manual_override INTEGER,
      dedupe_group_key TEXT,
      dedupe_source_amount REAL,
      dedupe_source_date TEXT,
      split_parent_id INTEGER,
      is_hidden INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      priority INTEGER DEFAULT 0,
      match_column TEXT,
      match_operator TEXT,
      match_value TEXT,
      action_type TEXT,
      action_payload TEXT,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  for (const [key, value] of Object.entries(DEFAULT_ANALYTICS_SETTINGS)) {
    await db.exec(`
      INSERT OR IGNORE INTO app_settings (key, value)
      VALUES (${sqlValue(key)}, ${sqlValue(JSON.stringify(normalizeStringList(value)))});
    `);
  }

  const tableInfo = rowify(await db.exec('PRAGMA table_info(transactions);'));
  const columns = new Set(tableInfo.map((col) => String(col.name)));

  for (const [columnName, columnType] of Object.entries(REQUIRED_COLUMNS)) {
    if (!columns.has(columnName)) {
      await db.exec(`ALTER TABLE transactions ADD COLUMN ${columnName} ${columnType};`);
    }
  }

  // Migration: ensure legacy rows default to visible for the ghost-parent architecture.
  await db.exec(`
    UPDATE transactions
    SET is_hidden = COALESCE(is_hidden, 0);
  `);

  await db.exec(`
    UPDATE transactions
    SET dedupe_group_key = COALESCE(dedupe_group_key, 'legacy-' || id),
        dedupe_source_amount = COALESCE(dedupe_source_amount, amount),
        dedupe_source_date = COALESCE(dedupe_source_date, date);
  `);

  // Clean up historical duplicate rows before enforcing the unique index.
  // Keep the oldest row (smallest id) for each (date, description, amount) tuple.
  await db.exec(`
    DELETE FROM transactions
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM transactions
      GROUP BY date, description, amount
    );
  `);

  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_transactions_date_desc_amount
    ON transactions (date, description, amount);
  `);

  await ensureRulesTableSchema(db);

  await db.exec(`
    UPDATE rules
    SET
      name = COALESCE(name, 'Unnamed Rule ' || id),
      priority = COALESCE(priority, 0),
      match_column = COALESCE(match_column, 'description'),
      match_operator = COALESCE(match_operator, 'contains'),
      match_value = COALESCE(match_value, ''),
      action_type = COALESCE(action_type, 'categorize'),
      action_payload = COALESCE(action_payload, ''),
      is_active = COALESCE(is_active, 1);
  `);
}

export async function getTransactions(db, { startDate, endDate, categories = [] } = {}) {
  if (!db) return [];
  const { excludedPatternSql } = await getAnalyticsSqlFragments(db);

  const conditions = ['is_hidden = 0'];
  if (startDate) conditions.push(`date >= ${sqlValue(startDate)}`);
  if (endDate) conditions.push(`date <= ${sqlValue(endDate)}`);

  if (Array.isArray(categories) && categories.length > 0) {
    const categoryList = categories.map((category) => sqlValue(category)).join(', ');
    conditions.push(`category IN (${categoryList})`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = rowify(await db.exec(`
    SELECT
      id,
      date,
      description,
      amount,
      account,
      category,
      source_file,
      manual_override,
      split_parent_id,
      CASE
        WHEN manual_override = 1 THEN 1
        WHEN manual_override = 0 THEN 0
        WHEN ${excludedPatternSql} THEN 1
        ELSE 0
      END AS is_excluded
    FROM transactions
    ${whereClause}
    ORDER BY date DESC;
  `));

  return rows.map(toTransaction);
}

export async function createTransaction(db, tx) {
  await bootstrapSchema(db);

  const dedupeGroupKey = randomKey('manual');

  await db.exec(`
    INSERT INTO transactions (
      date, description, amount, account, category, source_file, manual_override,
      dedupe_group_key, dedupe_source_amount, dedupe_source_date
    ) VALUES (
      ${sqlValue(tx.date)},
      ${sqlValue(tx.description)},
      ${sqlValue(toNumber(tx.amount))},
      ${sqlValue(tx.account)},
      ${sqlValue(tx.category)},
      ${sqlValue(tx.source_file || 'Manual Entry')},
      ${sqlValue(tx.manual_override ?? null)},
      ${sqlValue(dedupeGroupKey)},
      ${sqlValue(toNumber(tx.amount))},
      ${sqlValue(tx.date)}
    );
  `);

  const id = Number(await scalar(db, 'SELECT last_insert_rowid() AS id;', 0));
  await saveDbToBrowser(db);
  return { status: 'success', id };
}

export async function updateTransaction(db, transactionId, tx) {
  await db.exec(`
    UPDATE transactions
    SET
      date = ${sqlValue(tx.date)},
      description = ${sqlValue(tx.description)},
      amount = ${sqlValue(toNumber(tx.amount))},
      account = ${sqlValue(tx.account)},
      category = ${sqlValue(tx.category)},
      source_file = ${sqlValue(tx.source_file)},
      manual_override = ${sqlValue(tx.manual_override ?? null)}
    WHERE id = ${sqlValue(transactionId)};
  `);

  await saveDbToBrowser(db);
  return { status: 'success', id: Number(transactionId) };
}

export async function deleteTransaction(db, transactionId) {
  await db.exec(`DELETE FROM transactions WHERE id = ${sqlValue(transactionId)};`);
  const affectedRows = Number(await scalar(db, 'SELECT changes() AS changes_count;', 0));

  if (affectedRows === 0) {
    throw new Error('Transaction not found');
  }

  await saveDbToBrowser(db);
  return { status: 'success', id: Number(transactionId) };
}

export async function overrideTransaction(db, transactionId, overrideStatus) {
  await db.exec(`
    UPDATE transactions
    SET manual_override = ${sqlValue(overrideStatus)}
    WHERE id = ${sqlValue(transactionId)};
  `);

  await saveDbToBrowser(db);
  return { status: 'success', override_status: overrideStatus };
}

export async function getRules(db, { activeOnly = false } = {}) {
  if (!db) return [];

  const whereClause = activeOnly ? 'WHERE is_active = 1' : '';

  const rows = rowify(await db.exec(`
    SELECT
      id,
      name,
      priority,
      match_column,
      match_operator,
      match_value,
      action_type,
      action_payload,
      is_active
    FROM rules
    ${whereClause}
    ORDER BY priority ASC, id ASC;
  `));

  return rows.map(toRule);
}

export async function getAnalyticsSettingsConfig(db) {
  if (!db) return null;

  await bootstrapSchema(db);
  const settings = await getAnalyticsSettings(db);

  return {
    excluded_category_keywords: settings.excludedCategoryKeywords,
    excluded_description_keywords: settings.excludedDescriptionKeywords,
    reimbursement_excluded_categories: settings.reimbursementExcludedCategories,
  };
}

export async function updateAnalyticsSettingsConfig(db, updates = {}) {
  if (!db) {
    throw new Error('Database is not initialized.');
  }

  await bootstrapSchema(db);

  const nextExcludedCategoryKeywords = Array.isArray(updates.excluded_category_keywords)
    ? updates.excluded_category_keywords
    : DEFAULT_ANALYTICS_SETTINGS[SETTINGS_KEYS.excludedCategoryKeywords];

  const nextExcludedDescriptionKeywords = Array.isArray(updates.excluded_description_keywords)
    ? updates.excluded_description_keywords
    : DEFAULT_ANALYTICS_SETTINGS[SETTINGS_KEYS.excludedDescriptionKeywords];

  const nextReimbursementExcludedCategories = Array.isArray(updates.reimbursement_excluded_categories)
    ? updates.reimbursement_excluded_categories
    : DEFAULT_ANALYTICS_SETTINGS[SETTINGS_KEYS.reimbursementExcludedCategories];

  await db.exec('BEGIN TRANSACTION;');
  let transactionCommitted = false;

  try {
    const records = [
      {
        key: SETTINGS_KEYS.excludedCategoryKeywords,
        value: serializeStringListSetting(
          nextExcludedCategoryKeywords,
          DEFAULT_ANALYTICS_SETTINGS[SETTINGS_KEYS.excludedCategoryKeywords],
        ),
      },
      {
        key: SETTINGS_KEYS.excludedDescriptionKeywords,
        value: serializeStringListSetting(
          nextExcludedDescriptionKeywords,
          DEFAULT_ANALYTICS_SETTINGS[SETTINGS_KEYS.excludedDescriptionKeywords],
        ),
      },
      {
        key: SETTINGS_KEYS.reimbursementExcludedCategories,
        value: serializeStringListSetting(
          nextReimbursementExcludedCategories,
          DEFAULT_ANALYTICS_SETTINGS[SETTINGS_KEYS.reimbursementExcludedCategories],
        ),
      },
    ];

    for (const record of records) {
      await db.exec(`
        INSERT INTO app_settings (key, value)
        VALUES (${sqlValue(record.key)}, ${sqlValue(record.value)})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value;
      `);
    }

    await db.exec('COMMIT;');
    transactionCommitted = true;
    await saveDbToBrowser(db);
  } catch (error) {
    if (!transactionCommitted) {
      await db.exec('ROLLBACK;');
    }
    throw error;
  }

  return getAnalyticsSettingsConfig(db);
}

export async function createRule(db, rule) {
  const values = buildRuleInsertValues(rule);

  await db.exec(`
    INSERT INTO rules (
      name,
      priority,
      match_column,
      match_operator,
      match_value,
      action_type,
      action_payload,
      is_active
    ) VALUES (
      ${sqlValue(values.name)},
      ${sqlValue(values.priority)},
      ${sqlValue(values.match_column)},
      ${sqlValue(values.match_operator)},
      ${sqlValue(values.match_value)},
      ${sqlValue(values.action_type)},
      ${sqlValue(values.action_payload)},
      ${sqlValue(values.is_active)}
    );
  `);

  const id = Number(await scalar(db, 'SELECT last_insert_rowid() AS id;', 0));
  await saveDbToBrowser(db);
  return { status: 'success', id };
}

export async function updateRule(db, ruleId, rule) {
  const values = buildRuleUpdateValues({ ...rule, id: ruleId });

  await db.exec(`
    UPDATE rules
    SET
      name = ${sqlValue(values.name)},
      priority = ${sqlValue(values.priority)},
      match_column = ${sqlValue(values.match_column)},
      match_operator = ${sqlValue(values.match_operator)},
      match_value = ${sqlValue(values.match_value)},
      action_type = ${sqlValue(values.action_type)},
      action_payload = ${sqlValue(values.action_payload)},
      is_active = ${sqlValue(values.is_active)}
    WHERE id = ${sqlValue(values.id)};
  `);

  await saveDbToBrowser(db);
  return { status: 'success', id: Number(ruleId) };
}

export async function deleteRule(db, ruleId) {
  await db.exec(`DELETE FROM rules WHERE id = ${sqlValue(ruleId)};`);
  const affectedRows = Number(await scalar(db, 'SELECT changes() AS changes_count;', 0));

  if (affectedRows === 0) {
    throw new Error('Rule not found');
  }

  await saveDbToBrowser(db);
  return { status: 'success', id: Number(ruleId) };
}

export function applyRulesToImportedTransactions(rows, rules = []) {
  return rows.map((row) => applyRulesToImportedTransaction(row, rules));
}

export async function executeRuleOnDatabase(db, rule) {
  if (!db) {
    throw new Error('Database is not initialized.');
  }

  const normalizedRule = toRule({
    ...rule,
    is_active: rule?.is_active ? 1 : 0,
  });

  const rows = rowify(await db.exec(`
    SELECT
      id,
      date,
      description,
      amount,
      account,
      category,
      source_file,
      manual_override,
      dedupe_group_key,
      dedupe_source_amount,
      dedupe_source_date,
      split_parent_id,
      is_hidden
    FROM transactions
    WHERE is_hidden = 0
    ORDER BY id ASC;
  `));

  const matchedRows = rows.filter((row) => ruleMatchesTransaction(row, normalizedRule));
  if (matchedRows.length === 0) {
    return 0;
  }

  const actionType = normalizeRuleActionType(normalizedRule.action_type);
  await db.exec('BEGIN TRANSACTION;');
  let transactionCommitted = false;

  try {
    let affectedRows = 0;

    if (actionType === 'categorize') {
      const targetCategory = normalizeText(normalizedRule.action_payload);
      if (!targetCategory) {
        throw new Error('Categorize rules require a target category.');
      }

      const matchedIds = matchedRows.map((row) => Number(row.id)).join(', ');
      await db.exec(`
        UPDATE transactions
        SET category = ${sqlValue(targetCategory)}
        WHERE id IN (${matchedIds});
      `);

      affectedRows = Number(await scalar(db, 'SELECT changes() AS changes_count;', 0));
    } else if (actionType === 'split') {
      for (const parentRow of matchedRows) {
        const splits = parseSplitDefinitions(normalizedRule.action_payload, parentRow.amount);
        const dedupeGroupKey = parentRow.dedupe_group_key || randomKey('split');
        const dedupeSourceAmount = parentRow.dedupe_source_amount ?? parentRow.amount;
        const dedupeSourceDate = parentRow.dedupe_source_date || parentRow.date;

        await db.exec(`
          UPDATE transactions
          SET is_hidden = 1,
              dedupe_group_key = ${sqlValue(dedupeGroupKey)},
              dedupe_source_amount = ${sqlValue(dedupeSourceAmount)},
              dedupe_source_date = ${sqlValue(dedupeSourceDate)}
          WHERE id = ${sqlValue(parentRow.id)};
        `);

        const parentAffectedRows = Number(await scalar(db, 'SELECT changes() AS changes_count;', 0));
        if (parentAffectedRows === 0) {
          throw new Error('Original transaction was not found.');
        }

        affectedRows += parentAffectedRows;

        for (const split of splits) {
          await db.exec(`
            INSERT INTO transactions (
              date,
              description,
              amount,
              account,
              category,
              source_file,
              manual_override,
              dedupe_group_key,
              dedupe_source_amount,
              dedupe_source_date,
              split_parent_id,
              is_hidden
            ) VALUES (
              ${sqlValue(parentRow.date)},
              ${sqlValue(split.description || parentRow.description)},
              ${sqlValue(split.amount)},
              ${sqlValue(parentRow.account)},
              ${sqlValue(split.category)},
              ${sqlValue(parentRow.source_file)},
              ${sqlValue(parentRow.manual_override)},
              ${sqlValue(dedupeGroupKey)},
              ${sqlValue(dedupeSourceAmount)},
              ${sqlValue(dedupeSourceDate)},
              ${sqlValue(parentRow.id)},
              0
            );
          `);

          affectedRows += Number(await scalar(db, 'SELECT changes() AS changes_count;', 0));
        }
      }
    } else {
      throw new Error(`Unsupported rule action type: ${normalizedRule.action_type}`);
    }

    await db.exec('COMMIT;');
    transactionCommitted = true;
    await saveDbToBrowser(db);
    return affectedRows;
  } catch (error) {
    if (!transactionCommitted) {
      await db.exec('ROLLBACK;');
    }
    throw error;
  }
}

export async function splitTransaction(db, transactionId, payload) {
  const splits = payload?.splits || [];
  if (splits.length < 2) {
    throw new Error('Provide at least two split lines.');
  }

  if (splits.some((line) => Math.abs(toNumber(line.amount)) < 0.005)) {
    throw new Error('Split amounts must be non-zero.');
  }

  const originalRows = rowify(await db.exec(`SELECT * FROM transactions WHERE id = ${sqlValue(transactionId)} LIMIT 1;`));
  const original = originalRows[0];
  if (!original) {
    throw new Error('Transaction not found');
  }

  const splitTotal = round2(splits.reduce((sum, line) => sum + toNumber(line.amount), 0));
  const originalAmount = round2(toNumber(original.amount));
  if (Math.abs(splitTotal - originalAmount) > 0.01) {
    throw new Error(`Split amounts must sum to ${originalAmount.toFixed(2)}. Received ${splitTotal.toFixed(2)}.`);
  }

  const dedupeGroupKey = original.dedupe_group_key || randomKey('split');
  const dedupeSourceAmount = original.dedupe_source_amount ?? original.amount;
  const dedupeSourceDate = original.dedupe_source_date || original.date;

  await db.exec('BEGIN TRANSACTION;');
  let transactionCommitted = false;
  try {
    const createdIds = [];

    for (const line of splits) {
      const description = String(line.description || original.description || '').trim();
      const category = String(line.category || '').trim();
      if (!description || !category) {
        throw new Error('Each split line must include a description and category.');
      }

      await db.exec(`
        INSERT INTO transactions (
          date, description, amount, account, category, source_file, manual_override,
          dedupe_group_key, dedupe_source_amount, dedupe_source_date, split_parent_id
        ) VALUES (
          ${sqlValue(original.date)},
          ${sqlValue(description)},
          ${sqlValue(toNumber(line.amount))},
          ${sqlValue(original.account)},
          ${sqlValue(category)},
          ${sqlValue(original.source_file)},
          ${sqlValue(original.manual_override)},
          ${sqlValue(dedupeGroupKey)},
          ${sqlValue(dedupeSourceAmount)},
          ${sqlValue(dedupeSourceDate)},
          ${sqlValue(transactionId)}
        );
      `);

      const newId = Number(await scalar(db, 'SELECT last_insert_rowid() AS id;', 0));
      createdIds.push(newId);
    }

    await db.exec(`
      UPDATE transactions
      SET is_hidden = 1
      WHERE id = ${sqlValue(transactionId)};
    `);

    await db.exec('COMMIT;');
  transactionCommitted = true;
    await saveDbToBrowser(db);

    return {
      status: 'success',
      original_id: Number(transactionId),
      created_ids: createdIds,
      deleted_original: false,
      hidden_original: true,
    };
  } catch (error) {
    if (!transactionCommitted) {
      await db.exec('ROLLBACK;');
    }
    throw error;
  }
}

export async function undoSplitTransaction(db, transactionId) {
  const targetRows = rowify(await db.exec(`
    SELECT id, split_parent_id
    FROM transactions
    WHERE id = ${sqlValue(transactionId)}
    LIMIT 1;
  `));

  const target = targetRows[0];
  if (!target) {
    throw new Error('Transaction not found');
  }

  const requestedId = Number(transactionId);
  const inferredParentId = target.split_parent_id === null || target.split_parent_id === undefined
    ? null
    : Number(target.split_parent_id);

  const parentId = inferredParentId ?? requestedId;

  const splitCount = Number(await scalar(
    db,
    `SELECT COUNT(*) AS row_count FROM transactions WHERE split_parent_id = ${sqlValue(parentId)};`,
    0,
  ));

  if (splitCount === 0) {
    throw new Error('Selected transaction is not part of a split group.');
  }

  await db.exec('BEGIN TRANSACTION;');
  let transactionCommitted = false;
  try {
    await db.exec(`
      DELETE FROM transactions
      WHERE split_parent_id = ${sqlValue(parentId)};
    `);

    await db.exec(`
      UPDATE transactions
      SET is_hidden = 0
      WHERE id = ${sqlValue(parentId)};
    `);

    const parentAffectedRows = Number(await scalar(db, 'SELECT changes() AS changes_count;', 0));
    if (parentAffectedRows === 0) {
      throw new Error('Original split parent transaction was not found.');
    }

    await db.exec('COMMIT;');
    transactionCommitted = true;
    await saveDbToBrowser(db);

    return {
      status: 'success',
      parent_id: parentId,
      deleted_split_rows: splitCount,
    };
  } catch (error) {
    if (!transactionCommitted) {
      await db.exec('ROLLBACK;');
    }
    throw error;
  }
}

export async function getKpis(db, month) {
  const {
    includedConditionSql,
    reimbursementExcludedCategoriesSql,
  } = await getAnalyticsSqlFragments(db);

  const rows = rowify(await db.exec(`
    SELECT
      COALESCE(SUM(CASE WHEN amount > 0 AND LOWER(category) = 'income' AND ${includedConditionSql} THEN amount ELSE 0 END), 0) AS total_income,
      COALESCE(SUM(CASE WHEN amount > 0 AND LOWER(category) NOT IN ${reimbursementExcludedCategoriesSql} AND ${includedConditionSql} THEN amount ELSE 0 END), 0) AS total_reimbursements,
      COALESCE(ABS(SUM(CASE WHEN amount < 0 AND ${includedConditionSql} THEN amount ELSE 0 END)), 0) AS gross_expenses,
      COALESCE(SUM(amount), 0) AS net_flow
    FROM transactions
    WHERE strftime('%Y-%m', date) = ${sqlValue(month)}
      AND is_hidden = 0;
  `));

  const row = rows[0] || {};
  const grossExpenses = round2(row.gross_expenses || 0);
  const reimbursements = round2(row.total_reimbursements || 0);

  return {
    month,
    total_income: round2(row.total_income || 0),
    total_reimbursements: reimbursements,
    gross_expenses: grossExpenses,
    net_expenses: round2(grossExpenses - reimbursements),
    net_flow: round2(row.net_flow || 0),
  };
}

export async function getSpendingByCategory(db, { startDate, endDate } = {}) {
  const {
    includedConditionSql,
    reimbursementExcludedCategoriesSql,
  } = await getAnalyticsSqlFragments(db);

  const dateConditions = [];
  if (startDate) dateConditions.push(`date >= ${sqlValue(startDate)}`);
  if (endDate) dateConditions.push(`date <= ${sqlValue(endDate)}`);

  const dateClause = dateConditions.length ? ` AND ${dateConditions.join(' AND ')}` : '';

  const categoryRows = rowify(await db.exec(`
    SELECT category, SUM(amount) AS total
    FROM transactions
    WHERE amount < 0
      AND is_hidden = 0
      AND ${includedConditionSql}
      ${dateClause}
    GROUP BY category
    ORDER BY total ASC;
  `));

  const totalRows = rowify(await db.exec(`
    SELECT
      COALESCE(ABS(SUM(CASE WHEN amount < 0 AND ${includedConditionSql} THEN amount ELSE 0 END)), 0) AS gross_expenses,
      COALESCE(SUM(CASE WHEN amount > 0
        AND LOWER(category) NOT IN ${reimbursementExcludedCategoriesSql}
        AND ${includedConditionSql}
      THEN amount ELSE 0 END), 0) AS reimbursed_amount
    FROM transactions
    WHERE 1=1
      AND is_hidden = 0
      ${dateClause};
  `));

  const totals = totalRows[0] || {};
  const grossExpenses = round2(totals.gross_expenses || 0);
  const reimbursedAmount = round2(totals.reimbursed_amount || 0);

  return {
    categories: categoryRows.map((row) => ({
      category: row.category,
      total: round2(row.total),
    })),
    total_gross_expenses: grossExpenses,
    total_net_expenses: round2(grossExpenses - reimbursedAmount),
  };
}

export async function getSpendingTrend(db, { startDate, endDate } = {}) {
  const {
    includedConditionSql,
    reimbursementExcludedCategoriesSql,
  } = await getAnalyticsSqlFragments(db);

  const conditions = ['is_hidden = 0'];
  if (startDate) conditions.push(`date >= ${sqlValue(startDate)}`);
  if (endDate) conditions.push(`date <= ${sqlValue(endDate)}`);

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = rowify(await db.exec(`
    SELECT
      strftime('%Y-%m', date) AS month,
      COALESCE(SUM(CASE WHEN amount > 0 AND LOWER(category) = 'income' AND ${includedConditionSql} THEN amount ELSE 0 END), 0) AS total_income,
      COALESCE(SUM(CASE WHEN amount > 0 AND LOWER(category) NOT IN ${reimbursementExcludedCategoriesSql} AND ${includedConditionSql} THEN amount ELSE 0 END), 0) AS reimbursed_amount,
      COALESCE(ABS(SUM(CASE WHEN amount < 0 AND ${includedConditionSql} THEN amount ELSE 0 END)), 0) AS gross_expenses,
      COALESCE(SUM(amount), 0) AS net_flow
    FROM transactions
    ${whereClause}
    GROUP BY month
    ORDER BY month ASC;
  `));

  return rows
    .filter((row) => row.month)
    .map((row) => {
      const grossExpenses = round2(row.gross_expenses || 0);
      const reimbursedAmount = round2(row.reimbursed_amount || 0);
      return {
        month: row.month,
        total_income: round2(row.total_income || 0),
        reimbursed_amount: reimbursedAmount,
        gross_expenses: grossExpenses,
        net_expenses: round2(grossExpenses - reimbursedAmount),
        net_flow: round2(row.net_flow || 0),
      };
    });
}

export async function getDailySpending(db, { startDate, endDate } = {}) {
  const {
    includedConditionSql,
    reimbursementExcludedCategoriesSql,
  } = await getAnalyticsSqlFragments(db);

  const conditions = ['is_hidden = 0'];
  if (startDate) conditions.push(`date >= ${sqlValue(startDate)}`);
  if (endDate) conditions.push(`date <= ${sqlValue(endDate)}`);

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = rowify(await db.exec(`
    SELECT
      date AS day,
      COALESCE(SUM(CASE WHEN amount > 0 AND LOWER(category) = 'income' AND ${includedConditionSql} THEN amount ELSE 0 END), 0) AS total_income,
      COALESCE(SUM(CASE WHEN amount > 0 AND LOWER(category) NOT IN ${reimbursementExcludedCategoriesSql} AND ${includedConditionSql} THEN amount ELSE 0 END), 0) AS reimbursed_amount,
      COALESCE(ABS(SUM(CASE WHEN amount < 0 AND ${includedConditionSql} THEN amount ELSE 0 END)), 0) AS gross_expenses
    FROM transactions
    ${whereClause}
    GROUP BY day
    ORDER BY day ASC;
  `));

  return rows
    .filter((row) => row.day)
    .map((row) => {
      const grossExpenses = round2(row.gross_expenses || 0);
      const reimbursedAmount = round2(row.reimbursed_amount || 0);
      return {
        date: row.day,
        total_income: round2(row.total_income || 0),
        reimbursed_amount: reimbursedAmount,
        gross_expenses: grossExpenses,
        net_expenses: round2(grossExpenses - reimbursedAmount),
      };
    });
}
