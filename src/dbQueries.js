import { saveDbToBrowser } from './dbStorage.js';
import {
  binds,
  changes,
  inTransaction,
  lastInsertId,
  normalizeLower,
  normalizeText,
  placeholders,
  queryRows,
  randomKey,
  round2,
  rowify,
  scalar,
  sqlValue,
  toNumber,
} from './db/sql.js';
import { getMerchantRules, refreshMerchants } from './db/merchants-store.js';
import { resolveMerchant } from './db/merchants.js';

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
  // Nth identical (date, description, amount) row within one statement, so two same-day
  // $5 coffees are kept as two rows while re-importing the same file still dedupes.
  dedupe_seq: 'INTEGER DEFAULT 0',
  import_batch_id: 'TEXT',
  applied_rule_id: 'INTEGER',
  merchant: 'TEXT',
  reimburses_id: 'INTEGER',
};

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
    // A saved empty list means the user cleared it on purpose; only fall back when unreadable.
    return Array.isArray(parsed) ? normalizeStringList(parsed) : parsedFallback;
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
  // Escape LIKE wildcards so keywords containing % or _ match literally.
  const escapeLike = (keyword) => keyword.replace(/[\\%_]/g, (char) => `\\${char}`);
  return normalized
    .map((keyword) => `${columnSql} ${operator} ${sqlValue(`%${escapeLike(keyword)}%`)} ESCAPE '\\'`)
    .join(joiner);
};

const buildNotInListSql = (values) => {
  const normalized = normalizeStringList(values);
  if (normalized.length === 0) {
    return "('income')";
  }

  return `(${normalized.map((value) => sqlValue(value)).join(', ')})`;
};

const ensureAppSettingsSchema = async (db) => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  for (const [key, value] of Object.entries(DEFAULT_ANALYTICS_SETTINGS)) {
    await db.exec(
      'INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?);',
      binds(key, JSON.stringify(normalizeStringList(value))),
    );
  }
};

const getAnalyticsSettings = async (db) => {
  const cached = settingsCache.get(db);
  if (cached) return cached;

  await bootstrapSchema(db);
  const defaults = DEFAULT_ANALYTICS_SETTINGS;

  const keys = Object.values(SETTINGS_KEYS);
  const rows = await queryRows(db, `SELECT key, value FROM app_settings WHERE key IN (${placeholders(keys.length)});`, keys);

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

  const settings = {
    excludedCategoryKeywords,
    excludedDescriptionKeywords,
    reimbursementExcludedCategories,
  };
  settingsCache.set(db, settings);
  return settings;
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
  // Incoming money that offsets spending: anything linked to an expense, plus positive
  // rows outside the excluded categories (income, transfers, ...).
  const reimbursementConditionSql = `(
    amount > 0 AND ${includedConditionSql} AND (
      reimburses_id IS NOT NULL OR LOWER(category) NOT IN ${reimbursementExcludedCategoriesSql}
    )
  )`;

  return {
    excludedPatternSql,
    includedConditionSql,
    reimbursementExcludedCategoriesSql,
    reimbursementConditionSql,
  };
};

// SQL condition that is true for rows counted in spending analytics.
export async function getAnalyticsInclusionSql(db) {
  return (await getAnalyticsSqlFragments(db)).includedConditionSql;
}

const serializeStringListSetting = (values, fallbackValues = []) => {
  const finalValues = Array.isArray(values) ? normalizeStringList(values) : normalizeStringList(fallbackValues);
  return JSON.stringify(finalValues);
};

const toRule = (row) => ({
  id: Number(row.id),
  name: normalizeText(row.name),
  priority: Number(row.priority ?? 0),
  // Legacy V1 fields — kept for backward compat, superseded by match_payload
  match_column: normalizeText(row.match_column),
  match_operator: normalizeText(row.match_operator),
  match_value: normalizeText(row.match_value),
  // V2 compound-condition field
  match_payload: row.match_payload ?? null,
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

// Returns null when the rule's split lines don't add up to this row's amount,
// so a fixed-amount split rule simply doesn't apply to that row.
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

  const totalAmount = round2(toNumber(parentAmount));

  // Detect whether this is the new V2 format (has `type`) or legacy V1 (has `amount`).
  const isV2 = splits.some((line) => line?.type !== undefined);

  if (!isV2) {
    // ── Legacy V1 path: all lines have an explicit `amount` ──────────────
    const normalizedSplits = splits.map((line) => {
      const category = normalizeText(line?.category);
      const description = normalizeText(line?.description);
      const amount = round2(toNumber(line?.amount, NaN));

      if (!category) throw new Error('Each split line must include a category.');
      if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) {
        throw new Error('Split amounts must be non-zero.');
      }

      return { category, description, amount };
    });

    const splitTotal = round2(normalizedSplits.reduce((sum, l) => sum + l.amount, 0));
    if (Math.abs(splitTotal - totalAmount) > 0.01) {
      return null;
    }

    return normalizedSplits;
  }

  // ── V2 path: fixed / percentage / remainder ───────────────────────────
  const remainderLines = splits.filter((line) => normalizeLower(line?.type) === 'remainder');
  if (remainderLines.length > 1) {
    throw new Error('A split rule may only have one Remainder line.');
  }

  const totalPercentage = splits
    .filter((line) => normalizeLower(line?.type) === 'percentage')
    .reduce((sum, line) => sum + toNumber(line?.value, 0), 0);

  if (totalPercentage > 100) {
    throw new Error(`Percentages must not exceed 100%. Received ${totalPercentage}%.`);
  }

  // Calculate fixed amounts first.
  let allocated = 0;
  const normalizedSplits = splits.map((line) => {
    const category = normalizeText(line?.category);
    const description = normalizeText(line?.description);
    const type = normalizeLower(line?.type) || 'fixed';

    if (!category) throw new Error('Each split line must include a category.');

    let amount;
    if (type === 'fixed') {
      amount = round2(toNumber(line?.value, NaN));
      if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) {
        throw new Error('Fixed split amounts must be non-zero.');
      }
      allocated = round2(allocated + amount);
    } else if (type === 'percentage') {
      amount = round2(totalAmount * (toNumber(line?.value, 0) / 100));
      allocated = round2(allocated + amount);
    } else {
      // placeholder — remainder filled after the loop
      amount = null;
    }

    return { category, description, amount, _type: type };
  });

  // Assign the remainder amount. Without a remainder line the lines must cover the
  // whole row, and a remainder must keep the row's sign; otherwise the children would
  // not add back up to the hidden parent, so the rule doesn't apply to this row.
  const remainderAmount = round2(totalAmount - allocated);
  if (remainderLines.length === 0) {
    if (Math.abs(allocated - totalAmount) > 0.01) return null;
  } else if (Math.abs(remainderAmount) < 0.005 || Math.sign(remainderAmount) !== Math.sign(totalAmount)) {
    return null;
  }

  return normalizedSplits.map(({ _type, ...rest }) => {
    if (_type === 'remainder') {
      return { ...rest, amount: remainderAmount };
    }
    return rest;
  });
};

// Rows saved before merchant names existed (or rows not yet cleaned) fall back to
// the automatic cleanup so merchant conditions behave the same everywhere.
const conditionFieldValue = (transaction, column) => {
  if (column !== 'merchant') return transaction?.[column];
  return normalizeText(transaction?.merchant) || resolveMerchant(transaction?.description);
};

const evaluateCondition = (transaction, condition) => {
  const column = normalizeLower(condition?.column);
  if (!column) return false;

  const operator = normalizeRuleMatchOperator(condition?.operator);

  // Numeric operators
  if (operator === 'greater_than' || operator === 'less_than') {
    const txVal = toNumber(conditionFieldValue(transaction, column), NaN);
    const condVal = toNumber(condition?.value, NaN);
    if (!Number.isFinite(txVal) || !Number.isFinite(condVal)) return false;
    return operator === 'greater_than' ? txVal > condVal : txVal < condVal;
  }

  // Text operators
  const needle = normalizeLower(condition?.value);
  if (!needle) return false;
  const haystack = normalizeLower(conditionFieldValue(transaction, column));

  if (operator === 'contains') return haystack.includes(needle);
  if (operator === 'equals') return haystack === needle;
  if (operator === 'starts with') return haystack.startsWith(needle);

  return false;
};

const parseMatchPayload = (rule) => {
  // Prefer V2/V2.5 match_payload if present.
  if (rule.match_payload) {
    try {
      const parsed = typeof rule.match_payload === 'string'
        ? JSON.parse(rule.match_payload)
        : rule.match_payload;

      // V2.5 envelope: { match_type, conditions }
      if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.conditions)) {
        return {
          matchType: normalizeLower(parsed.match_type) === 'any' ? 'any' : 'all',
          conditions: parsed.conditions,
        };
      }

      // V2 bare array — treat as 'all'
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { matchType: 'all', conditions: parsed };
      }
    } catch {
      // fall through to legacy
    }
  }

  // V1 single-condition fields.
  const col = normalizeText(rule.match_column);
  const op = normalizeRuleMatchOperator(rule.match_operator);
  const val = normalizeText(rule.match_value);
  if (!col || !val) return { matchType: 'all', conditions: [] };
  return { matchType: 'all', conditions: [{ column: col, operator: op, value: val }] };
};

const ruleMatchesTransaction = (transaction, rule) => {
  const { matchType, conditions } = parseMatchPayload(rule);
  if (conditions.length === 0) return false;
  const test = (condition) => evaluateCondition(transaction, condition);
  return matchType === 'any'
    ? conditions.some(test)
    : conditions.every(test);
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
  import_batch_id: parentRow.import_batch_id ?? null,
  applied_rule_id: parentRow.applied_rule_id ?? null,
  merchant: parentRow.merchant ?? null,
  dedupe_seq: 0,
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
          applied_rule_id: rule.id ?? null,
        };
      }
      continue;
    }

    if (actionType === 'split') {
      const splits = parseSplitDefinitions(rule.action_payload, current.amount);
      if (!splits) continue;
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
        applied_rule_id: rule.id ?? null,
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

const serializeMatchPayload = (conditions) => {
  if (!Array.isArray(conditions) || conditions.length === 0) return null;
  return JSON.stringify(
    conditions.map((c) => ({
      column: normalizeText(c.column),
      operator: normalizeRuleMatchOperator(c.operator),
      value: normalizeText(c.value),
    }))
  );
};

const buildRuleInsertValues = (rule) => ({
  name: normalizeText(rule.name),
  priority: toNumber(rule.priority, 0),
  // V1 legacy columns — preserved for backward compat
  match_column: normalizeText(rule.match_column),
  match_operator: normalizeText(rule.match_operator),
  match_value: normalizeText(rule.match_value),
  // V2 compound conditions
  match_payload: rule.match_payload !== undefined
    ? (typeof rule.match_payload === 'string' ? rule.match_payload : serializeMatchPayload(rule.match_payload))
    : null,
  action_type: normalizeText(rule.action_type),
  action_payload: serializeRulePayload(rule.action_type, rule.action_payload),
  is_active: rule.is_active === undefined ? 1 : Number(Boolean(rule.is_active)),
});

const buildRuleUpdateValues = (rule) => ({
  ...buildRuleInsertValues(rule),
  id: Number(rule.id),
});

const RULE_COLUMNS = {
  name: 'TEXT',
  priority: 'INTEGER DEFAULT 0',
  match_column: 'TEXT',
  match_operator: 'TEXT',
  match_value: 'TEXT',
  match_payload: 'TEXT',
  action_type: 'TEXT',
  action_payload: 'TEXT',
  is_active: 'INTEGER DEFAULT 1',
};

const addMissingColumns = async (db, table, required) => {
  const existing = new Set(rowify(await db.exec(`PRAGMA table_info(${table});`)).map((col) => String(col.name)));
  for (const [name, type] of Object.entries(required)) {
    if (!existing.has(name)) {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type};`);
    }
  }
};

// Adds any column an older database is missing, so the UPDATE below never hits "no such column".
const ensureRulesTableSchema = async (db) => {
  await addMissingColumns(db, 'rules', RULE_COLUMNS);
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
    tags: row.tags ? String(row.tags).split(',').sort() : [],
  };
};

export async function ensureDedupeIndex(db) {
  await db.exec(`
    DROP INDEX IF EXISTS ux_transactions_date_desc_amount;
    DROP INDEX IF EXISTS ux_transactions_dedupe;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_transactions_dedupe_seq
    ON transactions (date, description, amount, dedupe_seq)
    WHERE split_parent_id IS NULL;
  `);
}

const ensureSupportTables = async (db) => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      file_name TEXT,
      profile_name TEXT,
      imported_at TEXT,
      inserted_count INTEGER DEFAULT 0,
      duplicate_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS csv_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      mapping TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS budgets (
      category TEXT PRIMARY KEY,
      monthly_amount REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transaction_tags (
      transaction_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (transaction_id, tag)
    );

    CREATE TABLE IF NOT EXISTS account_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL,
      date TEXT NOT NULL,
      balance REAL NOT NULL,
      UNIQUE (account, date)
    );

    CREATE TABLE IF NOT EXISTS merchant_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      merchant TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ix_transactions_visible_date ON transactions (is_hidden, date);
    CREATE INDEX IF NOT EXISTS ix_transactions_category ON transactions (category);
    CREATE INDEX IF NOT EXISTS ix_transactions_split_parent ON transactions (split_parent_id);
    CREATE INDEX IF NOT EXISTS ix_transactions_import_batch ON transactions (import_batch_id);
    CREATE INDEX IF NOT EXISTS ix_transaction_tags_tag ON transaction_tags (tag);
  `);
};

// Databases whose schema is already bootstrapped. DatabaseContext creates a new api
// object for every database it loads, so a reload starts unbootstrapped again.
const bootstrappedDbs = new WeakSet();
const bootstrapsInFlight = new WeakMap();
const settingsCache = new WeakMap();

// Overlapping callers (two pages mounting, StrictMode) share one run, since the
// ALTER TABLE migrations fail if they run twice.
export function bootstrapSchema(db) {
  if (bootstrappedDbs.has(db)) return Promise.resolve();
  let run = bootstrapsInFlight.get(db);
  if (!run) {
    run = runBootstrap(db).finally(() => bootstrapsInFlight.delete(db));
    bootstrapsInFlight.set(db, run);
  }
  return run;
}

async function runBootstrap(db) {

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
      match_payload TEXT,
      action_type TEXT,
      action_payload TEXT,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  await ensureAppSettingsSchema(db);

  await addMissingColumns(db, 'transactions', REQUIRED_COLUMNS);

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
  // Split children are excluded: two halves of one split can legitimately match.
  await db.exec(`
    DELETE FROM transactions
    WHERE split_parent_id IS NULL
      AND id NOT IN (
        SELECT MIN(id)
        FROM transactions
        WHERE split_parent_id IS NULL
        GROUP BY date, description, amount, COALESCE(dedupe_seq, 0)
      );
  `);

  await ensureDedupeIndex(db);

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

  // ── V1 → V2 Data Migration ──────────────────────────────────────────────────
  // For any rule with NULL match_payload, build it from the legacy V1 columns.
  const unmigratedV1 = rowify(await db.exec(`
    SELECT id, match_column, match_operator, match_value, action_type, action_payload
    FROM rules
    WHERE match_payload IS NULL;
  `));

  for (const row of unmigratedV1) {
    // Wrap directly in the V2.5 envelope so it never needs a second migration.
    const matchPayload = JSON.stringify({
      match_type: 'all',
      conditions: [{
        column: normalizeText(row.match_column) || 'description',
        operator: normalizeRuleMatchOperator(row.match_operator) || 'contains',
        value: normalizeText(row.match_value),
      }],
    });

    // Migrate split action_payload from V1 {amount} to V2 {type:'fixed', value}
    let actionPayload = row.action_payload;
    if (normalizeRuleActionType(row.action_type) === 'split' && actionPayload) {
      try {
        const parsed = typeof actionPayload === 'string' ? JSON.parse(actionPayload) : actionPayload;
        const splits = Array.isArray(parsed) ? parsed : parsed?.splits;
        if (Array.isArray(splits)) {
          const v2Splits = splits.map((line) => ({
            category: normalizeText(line?.category),
            description: normalizeText(line?.description),
            type: 'fixed',
            value: toNumber(line?.amount, 0),
          }));
          actionPayload = JSON.stringify({ splits: v2Splits });
        }
      } catch {
        // Leave action_payload as-is if parsing fails.
      }
    }

    await db.exec('UPDATE rules SET match_payload = ?, action_payload = ? WHERE id = ?;', binds(matchPayload, actionPayload, row.id));
  }

  // ── V2 → V2.5 Data Migration ─────────────────────────────────────────────────
  // Wrap any bare-array match_payload into the new { match_type, conditions } envelope.
  const unmigratedV2 = rowify(await db.exec(`
    SELECT id, match_payload
    FROM rules
    WHERE match_payload IS NOT NULL;
  `));

  for (const row of unmigratedV2) {
    try {
      const parsed = JSON.parse(row.match_payload);
      // Only needs migration if it's a bare array (V2), not already an object (V2.5)
      if (Array.isArray(parsed)) {
        const wrapped = JSON.stringify({ match_type: 'all', conditions: parsed });
        await db.exec('UPDATE rules SET match_payload = ? WHERE id = ?;', binds(wrapped, row.id));
      }
    } catch {
      // Unparseable payload — leave it alone; the engine falls back gracefully.
    }
  }

  await ensureSupportTables(db);
  // Rows from before merchant names existed get one computed once.
  await refreshMerchants(db, { onlyMissing: true });
  bootstrappedDbs.add(db);
}

export async function getTransactions(db, {
  startDate,
  endDate,
  categories = [],
  importBatchId,
  tag,
  ids,
} = {}) {
  if (!db) return [];
  const { excludedPatternSql } = await getAnalyticsSqlFragments(db);

  const conditions = ['t.is_hidden = 0'];
  const params = [];
  if (startDate) { conditions.push('t.date >= ?'); params.push(startDate); }
  if (endDate) { conditions.push('t.date <= ?'); params.push(endDate); }
  if (Array.isArray(categories) && categories.length > 0) {
    conditions.push(`t.category IN (${placeholders(categories.length)})`);
    params.push(...categories);
  }
  if (importBatchId) { conditions.push('t.import_batch_id = ?'); params.push(importBatchId); }
  if (tag) { conditions.push('t.id IN (SELECT transaction_id FROM transaction_tags WHERE tag = ?)'); params.push(tag); }
  if (Array.isArray(ids)) {
    if (ids.length === 0) return [];
    conditions.push(`t.id IN (${placeholders(ids.length)})`);
    params.push(...ids);
  }

  const rows = await queryRows(db, `
    SELECT
      t.id, t.date, t.description, t.amount, t.account, t.category, t.source_file,
      t.manual_override, t.split_parent_id, t.merchant, t.import_batch_id, t.reimburses_id,
      t.applied_rule_id, r.name AS applied_rule_name,
      tg.tags,
      CASE
        WHEN t.manual_override = 1 THEN 1
        WHEN t.manual_override = 0 THEN 0
        WHEN ${excludedPatternSql} THEN 1
        ELSE 0
      END AS is_excluded
    FROM transactions t
    LEFT JOIN rules r ON r.id = t.applied_rule_id
    LEFT JOIN (
      SELECT transaction_id, GROUP_CONCAT(tag, ',') AS tags FROM transaction_tags GROUP BY transaction_id
    ) tg ON tg.transaction_id = t.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.date DESC, t.id DESC;
  `, binds(...params));

  return rows.map(toTransaction);
}

// Lowest dedupe_seq not already used by an identical (date, description, amount) row,
// so a deliberate duplicate entered by hand never trips the unique index.
const nextDedupeSeq = async (db, date, description, amount, excludeId = null) => Number(await scalar(
  db,
  `SELECT COALESCE(MAX(dedupe_seq) + 1, 0) FROM transactions
   WHERE split_parent_id IS NULL AND date = ? AND description = ? AND amount = ? AND id IS NOT ?;`,
  0,
  binds(date, description, amount, excludeId),
));

export async function createTransaction(db, tx) {
  await bootstrapSchema(db);

  const amount = toNumber(tx.amount);
  const dedupeSeq = await nextDedupeSeq(db, tx.date, tx.description, amount);

  await db.exec(
    `INSERT INTO transactions (
      date, description, amount, account, category, source_file, manual_override,
      dedupe_group_key, dedupe_source_amount, dedupe_source_date, dedupe_seq, merchant
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    binds(
      tx.date,
      tx.description,
      amount,
      tx.account,
      tx.category,
      tx.source_file || 'Manual Entry',
      tx.manual_override ?? null,
      randomKey('manual'),
      amount,
      tx.date,
      dedupeSeq,
      resolveMerchant(tx.description, await getMerchantRules(db)),
    ),
  );

  const id = await lastInsertId(db);
  await saveDbToBrowser(db);
  return { status: 'success', id };
}

// Split halves must stay in step with their hidden original; undo the split to change them.
const assertNotSplitChild = async (db, transactionId) => {
  const parentId = await scalar(db, 'SELECT split_parent_id FROM transactions WHERE id = ?;', null, binds(transactionId));
  if (parentId !== null) {
    throw new Error('This transaction is part of a split. Undo the split before editing or deleting it.');
  }
};

export async function updateTransaction(db, transactionId, tx) {
  await assertNotSplitChild(db, transactionId);

  const amount = toNumber(tx.amount);
  const dedupeSeq = await nextDedupeSeq(db, tx.date, tx.description, amount, transactionId);

  // A hand-picked category no longer comes from the rule that set it.
  await db.exec(
    `UPDATE transactions
     SET applied_rule_id = CASE WHEN category IS ? THEN applied_rule_id ELSE NULL END
     WHERE id = ?;`,
    binds(tx.category, transactionId),
  );
  await db.exec(
    `UPDATE transactions
     SET date = ?, description = ?, amount = ?, account = ?, category = ?, source_file = ?,
         manual_override = ?, dedupe_seq = ?
     WHERE id = ?;`,
    binds(
      tx.date,
      tx.description,
      amount,
      tx.account,
      tx.category,
      tx.source_file,
      tx.manual_override ?? null,
      dedupeSeq,
      transactionId,
    ),
  );

  await saveDbToBrowser(db);
  return { status: 'success', id: Number(transactionId) };
}

export async function deleteTransaction(db, transactionId) {
  await assertNotSplitChild(db, transactionId);

  await inTransaction(db, async () => {
    await db.exec('DELETE FROM transactions WHERE id = ?;', binds(transactionId));
    if (await changes(db) === 0) {
      throw new Error('Transaction not found');
    }
    await db.exec('DELETE FROM transaction_tags WHERE transaction_id = ?;', binds(transactionId));
    await db.exec('UPDATE transactions SET reimburses_id = NULL WHERE reimburses_id = ?;', binds(transactionId));
  });

  await saveDbToBrowser(db);
  return { status: 'success', id: Number(transactionId) };
}

export async function overrideTransaction(db, transactionId, overrideStatus) {
  await db.exec('UPDATE transactions SET manual_override = ? WHERE id = ?;', binds(overrideStatus, transactionId));

  await saveDbToBrowser(db);
  return { status: 'success', override_status: overrideStatus };
}

export async function getRules(db, { activeOnly = false } = {}) {
  if (!db) return [];

  const rows = await queryRows(db, `
    SELECT id, name, priority, match_column, match_operator, match_value, match_payload,
           action_type, action_payload, is_active
    FROM rules
    ${activeOnly ? 'WHERE is_active = 1' : ''}
    ORDER BY priority ASC, id ASC;
  `);

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
      await db.exec(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;',
        binds(record.key, record.value),
      );
    }

    await db.exec('COMMIT;');
    transactionCommitted = true;
    settingsCache.delete(db);
    await saveDbToBrowser(db);
  } catch (error) {
    if (!transactionCommitted) {
      await db.exec('ROLLBACK;');
    }
    throw error;
  }

  return getAnalyticsSettingsConfig(db);
}

const RULE_VALUE_COLUMNS = ['name', 'priority', 'match_column', 'match_operator', 'match_value', 'match_payload', 'action_type', 'action_payload', 'is_active'];

export async function createRule(db, rule) {
  const values = buildRuleInsertValues(rule);

  await db.exec(
    `INSERT INTO rules (${RULE_VALUE_COLUMNS.join(', ')}) VALUES (${placeholders(RULE_VALUE_COLUMNS.length)});`,
    binds(...RULE_VALUE_COLUMNS.map((column) => values[column])),
  );

  const id = await lastInsertId(db);
  await saveDbToBrowser(db);
  return { status: 'success', id };
}

export async function updateRule(db, ruleId, rule) {
  const values = buildRuleUpdateValues({ ...rule, id: ruleId });

  await db.exec(
    `UPDATE rules SET ${RULE_VALUE_COLUMNS.map((column) => `${column} = ?`).join(', ')} WHERE id = ?;`,
    binds(...RULE_VALUE_COLUMNS.map((column) => values[column]), values.id),
  );

  await saveDbToBrowser(db);
  return { status: 'success', id: Number(ruleId) };
}

export async function deleteRule(db, ruleId) {
  await db.exec('DELETE FROM rules WHERE id = ?;', binds(ruleId));
  if (await changes(db) === 0) {
    throw new Error('Rule not found');
  }

  await db.exec('UPDATE transactions SET applied_rule_id = NULL WHERE applied_rule_id = ?;', binds(ruleId));
  await saveDbToBrowser(db);
  return { status: 'success', id: Number(ruleId) };
}

export function applyRulesToImportedTransactions(rows, rules = []) {
  return rows.map((row) => applyRulesToImportedTransaction(row, rules));
}

// Inserts one split half that belongs to `parent` (already hidden).
const insertSplitChild = async (db, parent, line, dedupe, appliedRuleId = null) => {
  await db.exec(
    `INSERT INTO transactions (
      date, description, amount, account, category, source_file, manual_override,
      dedupe_group_key, dedupe_source_amount, dedupe_source_date, split_parent_id, is_hidden,
      merchant, applied_rule_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?);`,
    binds(
      parent.date,
      line.description || parent.description,
      line.amount,
      parent.account,
      line.category,
      parent.source_file,
      parent.manual_override,
      dedupe.groupKey,
      dedupe.sourceAmount,
      dedupe.sourceDate,
      parent.id,
      parent.merchant ?? null,
      appliedRuleId,
    ),
  );
  return lastInsertId(db);
};

const dedupeInfoFor = (row) => ({
  groupKey: row.dedupe_group_key || randomKey('split'),
  sourceAmount: row.dedupe_source_amount ?? row.amount,
  sourceDate: row.dedupe_source_date || row.date,
});

// Rows a rule would change right now; shared by the sweep and the preview.
const findRuleMatches = async (db, rule) => {
  const rows = await queryRows(db, 'SELECT * FROM transactions WHERE is_hidden = 0 ORDER BY id ASC;');
  const matched = rows.filter((row) => ruleMatchesTransaction(row, rule));
  if (normalizeRuleActionType(rule.action_type) !== 'split') {
    return matched.map((row) => ({ row }));
  }
  return matched
    .filter((row) => row.split_parent_id === null || row.split_parent_id === undefined)
    .map((row) => ({ row, splits: parseSplitDefinitions(rule.action_payload, row.amount) }))
    .filter((match) => match.splits);
};

// Lists the rows a (possibly unsaved) rule would change, without changing anything.
export async function previewRule(db, rule) {
  await bootstrapSchema(db);
  const normalizedRule = toRule({ ...rule, is_active: 1 });
  const matches = await findRuleMatches(db, normalizedRule);
  const actionType = normalizeRuleActionType(normalizedRule.action_type);
  const target = normalizeText(normalizedRule.action_payload);
  return matches.map(({ row, splits }) => ({
    ...toTransaction(row),
    change: actionType === 'split'
      ? splits.map((line) => `${line.category} ${line.amount.toFixed(2)}`).join(' + ')
      : !target ? 'no target category yet'
        : row.category === target ? 'already in category' : `${row.category || 'Uncategorized'} → ${target}`,
  }));
}

export async function executeRuleOnDatabase(db, rule) {
  if (!db) {
    throw new Error('Database is not initialized.');
  }

  const normalizedRule = toRule({
    ...rule,
    is_active: rule?.is_active ? 1 : 0,
  });
  const ruleId = Number.isFinite(normalizedRule.id) ? normalizedRule.id : null;

  await bootstrapSchema(db);
  const matches = await findRuleMatches(db, normalizedRule);
  if (matches.length === 0) {
    return 0;
  }

  const actionType = normalizeRuleActionType(normalizedRule.action_type);
  const affectedRows = await inTransaction(db, async () => {
    let affected = 0;

    if (actionType === 'categorize') {
      const targetCategory = normalizeText(normalizedRule.action_payload);
      if (!targetCategory) {
        throw new Error('Categorize rules require a target category.');
      }

      const ids = matches.map(({ row }) => Number(row.id));
      await db.exec(
        `UPDATE transactions SET category = ?, applied_rule_id = ? WHERE id IN (${placeholders(ids.length)});`,
        binds(targetCategory, ruleId, ...ids),
      );
      affected = await changes(db);
    } else if (actionType === 'split') {
      for (const { row: parentRow, splits } of matches) {
        const dedupe = dedupeInfoFor(parentRow);
        await db.exec(
          `UPDATE transactions
           SET is_hidden = 1, dedupe_group_key = ?, dedupe_source_amount = ?, dedupe_source_date = ?, applied_rule_id = ?
           WHERE id = ?;`,
          binds(dedupe.groupKey, dedupe.sourceAmount, dedupe.sourceDate, ruleId, parentRow.id),
        );
        if (await changes(db) === 0) {
          throw new Error('Original transaction was not found.');
        }
        affected += 1;

        for (const split of splits) {
          await insertSplitChild(db, parentRow, split, dedupe, ruleId);
          affected += 1;
        }
      }
    } else {
      throw new Error(`Unsupported rule action type: ${normalizedRule.action_type}`);
    }

    return affected;
  });

  await saveDbToBrowser(db);
  return affectedRows;
}

export async function splitTransaction(db, transactionId, payload) {
  const splits = payload?.splits || [];
  if (splits.length < 2) {
    throw new Error('Provide at least two split lines.');
  }

  if (splits.some((line) => Math.abs(toNumber(line.amount)) < 0.005)) {
    throw new Error('Split amounts must be non-zero.');
  }

  const [original] = await queryRows(db, 'SELECT * FROM transactions WHERE id = ? LIMIT 1;', binds(transactionId));
  if (!original) {
    throw new Error('Transaction not found');
  }

  const splitTotal = round2(splits.reduce((sum, line) => sum + toNumber(line.amount), 0));
  const originalAmount = round2(toNumber(original.amount));
  if (Math.abs(splitTotal - originalAmount) > 0.01) {
    throw new Error(`Split amounts must sum to ${originalAmount.toFixed(2)}. Received ${splitTotal.toFixed(2)}.`);
  }

  const lines = splits.map((line) => ({
    description: normalizeText(line.description || original.description),
    category: normalizeText(line.category),
    amount: toNumber(line.amount),
  }));
  if (lines.some((line) => !line.description || !line.category)) {
    throw new Error('Each split line must include a description and category.');
  }

  const dedupe = dedupeInfoFor(original);
  const createdIds = await inTransaction(db, async () => {
    const ids = [];
    for (const line of lines) {
      ids.push(await insertSplitChild(db, original, line, dedupe));
    }
    await db.exec('UPDATE transactions SET is_hidden = 1 WHERE id = ?;', binds(transactionId));
    return ids;
  });

  await saveDbToBrowser(db);
  return {
    status: 'success',
    original_id: Number(transactionId),
    created_ids: createdIds,
    deleted_original: false,
    hidden_original: true,
  };
}

export async function undoSplitTransaction(db, transactionId) {
  const [target] = await queryRows(db, 'SELECT id, split_parent_id FROM transactions WHERE id = ? LIMIT 1;', binds(transactionId));
  if (!target) {
    throw new Error('Transaction not found');
  }

  const parentId = target.split_parent_id === null || target.split_parent_id === undefined
    ? Number(transactionId)
    : Number(target.split_parent_id);

  const splitCount = Number(await scalar(db, 'SELECT COUNT(*) FROM transactions WHERE split_parent_id = ?;', 0, binds(parentId)));
  if (splitCount === 0) {
    throw new Error('Selected transaction is not part of a split group.');
  }

  await inTransaction(db, async () => {
    await db.exec(
      'DELETE FROM transaction_tags WHERE transaction_id IN (SELECT id FROM transactions WHERE split_parent_id = ?);',
      binds(parentId),
    );
    await db.exec('DELETE FROM transactions WHERE split_parent_id = ?;', binds(parentId));
    await db.exec('UPDATE transactions SET is_hidden = 0 WHERE id = ?;', binds(parentId));
    if (await changes(db) === 0) {
      throw new Error('Original split parent transaction was not found.');
    }
  });

  await saveDbToBrowser(db);
  return {
    status: 'success',
    parent_id: parentId,
    deleted_split_rows: splitCount,
  };
}

const dateRange = (startDate, endDate) => {
  const parts = [];
  const params = [];
  if (startDate) { parts.push('date >= ?'); params.push(startDate); }
  if (endDate) { parts.push('date <= ?'); params.push(endDate); }
  return { clause: parts.length ? ` AND ${parts.join(' AND ')}` : '', params };
};

export async function getKpis(db, month) {
  const {
    includedConditionSql,
    reimbursementConditionSql,
  } = await getAnalyticsSqlFragments(db);

  const rows = await queryRows(db, `
    SELECT
      COALESCE(SUM(CASE WHEN amount > 0 AND LOWER(category) = 'income' AND reimburses_id IS NULL AND ${includedConditionSql} THEN amount ELSE 0 END), 0) AS total_income,
      COALESCE(SUM(CASE WHEN ${reimbursementConditionSql} THEN amount ELSE 0 END), 0) AS total_reimbursements,
      COALESCE(ABS(SUM(CASE WHEN amount < 0 AND ${includedConditionSql} THEN amount ELSE 0 END)), 0) AS gross_expenses,
      COALESCE(SUM(amount), 0) AS net_flow
    FROM transactions
    WHERE strftime('%Y-%m', date) = ?
      AND is_hidden = 0;
  `, binds(month));

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

/**
 * Spending per category for a date range: gross (included expenses), reimbursed
 * (credits linked to an expense count in that expense's category; other credits
 * count in their own category) and net = gross - reimbursed. Uses the same
 * reimbursement rule as the KPI and trend totals, so the categories add up to them.
 * With `byMonth`, rows are also split by the transaction's month.
 */
export async function getCategoryNetSpending(db, { startDate, endDate, byMonth = false } = {}) {
  const { includedConditionSql, reimbursementConditionSql } = await getAnalyticsSqlFragments(db);
  const { clause: dateClause, params: dateParams } = dateRange(startDate, endDate);
  const monthSql = byMonth ? "strftime('%Y-%m', date)" : "''";

  const rows = await queryRows(db, `
    SELECT month, category, SUM(gross) AS gross, SUM(reimbursed) AS reimbursed FROM (
      SELECT ${monthSql} AS month, category, -amount AS gross, 0 AS reimbursed
      FROM transactions
      WHERE is_hidden = 0 AND amount < 0 AND ${includedConditionSql} ${dateClause}
      UNION ALL
      SELECT r.month, COALESCE(e.category, r.category) AS category, 0 AS gross, r.amount AS reimbursed
      FROM (
        SELECT ${monthSql} AS month, category, amount, reimburses_id
        FROM transactions
        WHERE is_hidden = 0 AND ${reimbursementConditionSql} ${dateClause}
      ) r
      LEFT JOIN transactions e ON e.id = r.reimburses_id
    )
    GROUP BY month, category;
  `, [...dateParams, ...dateParams]);

  return rows.map((row) => {
    const gross = round2(row.gross);
    const reimbursed = round2(row.reimbursed);
    return {
      ...(byMonth ? { month: row.month } : {}),
      category: row.category,
      gross,
      reimbursed,
      net: round2(gross - reimbursed),
    };
  });
}

export async function getSpendingByCategory(db, { startDate, endDate } = {}) {
  const rows = await getCategoryNetSpending(db, { startDate, endDate });
  const totalGross = round2(rows.reduce((sum, row) => sum + row.gross, 0));
  const totalReimbursed = round2(rows.reduce((sum, row) => sum + row.reimbursed, 0));
  const toCategory = (row) => ({
    category: row.category,
    // Negative like the transactions themselves; existing callers sort and chart on it.
    total: -row.net,
    gross: row.gross,
    reimbursed: row.reimbursed,
    net: row.net,
  });

  return {
    // Categories with net spending, largest first.
    categories: rows.filter((row) => row.net > 0).sort((a, b) => b.net - a.net).map(toCategory),
    // Categories whose reimbursements covered all their spending (or more) in this range.
    reimbursed_categories: rows.filter((row) => row.net <= 0).sort((a, b) => a.net - b.net).map(toCategory),
    total_gross_expenses: totalGross,
    total_reimbursed: totalReimbursed,
    total_net_expenses: round2(totalGross - totalReimbursed),
  };
}

export async function getSpendingTrend(db, { startDate, endDate } = {}) {
  const {
    includedConditionSql,
    reimbursementConditionSql,
  } = await getAnalyticsSqlFragments(db);

  const { clause: dateClause, params: dateParams } = dateRange(startDate, endDate);
  const whereClause = `WHERE is_hidden = 0 ${dateClause}`;

  const rows = await queryRows(db, `
    SELECT
      strftime('%Y-%m', date) AS month,
      COALESCE(SUM(CASE WHEN amount > 0 AND LOWER(category) = 'income' AND reimburses_id IS NULL AND ${includedConditionSql} THEN amount ELSE 0 END), 0) AS total_income,
      COALESCE(SUM(CASE WHEN ${reimbursementConditionSql} THEN amount ELSE 0 END), 0) AS reimbursed_amount,
      COALESCE(ABS(SUM(CASE WHEN amount < 0 AND ${includedConditionSql} THEN amount ELSE 0 END)), 0) AS gross_expenses,
      COALESCE(SUM(amount), 0) AS net_flow
    FROM transactions
    ${whereClause}
    GROUP BY month
    ORDER BY month ASC;
  `, dateParams);

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
    reimbursementConditionSql,
  } = await getAnalyticsSqlFragments(db);

  const { clause: dateClause, params: dateParams } = dateRange(startDate, endDate);
  const whereClause = `WHERE is_hidden = 0 ${dateClause}`;

  const rows = await queryRows(db, `
    SELECT
      date AS day,
      COALESCE(SUM(CASE WHEN amount > 0 AND LOWER(category) = 'income' AND reimburses_id IS NULL AND ${includedConditionSql} THEN amount ELSE 0 END), 0) AS total_income,
      COALESCE(SUM(CASE WHEN ${reimbursementConditionSql} THEN amount ELSE 0 END), 0) AS reimbursed_amount,
      COALESCE(ABS(SUM(CASE WHEN amount < 0 AND ${includedConditionSql} THEN amount ELSE 0 END)), 0) AS gross_expenses
    FROM transactions
    ${whereClause}
    GROUP BY day
    ORDER BY day ASC;
  `, dateParams);

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
