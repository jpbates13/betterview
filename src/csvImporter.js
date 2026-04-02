import Papa from 'papaparse';
import { applyRulesToImportedTransactions, bootstrapSchema, getRules } from './dbQueries.js';
import { saveDbToBrowser } from './dbStorage.js';

const EXCLUDED_ACCOUNTS = new Set([
  'ROTH IRA',
  'Old Taxable Brokerage',
  'LIBERTY MUTUAL 401(K) PLAN',
  'LIBERTY MUTUAL 401(K)',
]);

const toSql = (value) => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
};

const parseAmount = (value) => {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[$,]/g, '').trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
};

const parseDateToIso = (value) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, mm, dd, yyyy] = slashMatch;
    return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }

  return null;
};

const stripPreambleAndFooter = (rawText) => {
  const lines = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  while (lines.length > 0 && lines[0].trim() === '') {
    lines.shift();
  }

  if (lines.length > 0) {
    const firstLine = lines[0].trim();
    const firstHasComma = firstLine.includes(',');
    const looksLikeTitle = /spending transactions|accounts history/i.test(firstLine);
    if (!firstHasComma || looksLikeTitle) {
      lines.shift();
    }
  }

  const footerMarkers = [
    'DATA GLOSSARY:',
    'TRANSACTION TYPE GLOSSARY:',
    'Date downloaded',
    '1099065.2.0',
  ];

  const footerIndex = lines.findIndex((line) => {
    const normalized = line.replace(/^"+|"+$/g, '').trim();
    return footerMarkers.some((marker) => normalized.startsWith(marker));
  });

  const contentLines = footerIndex >= 0 ? lines.slice(0, footerIndex) : lines;
  return contentLines.join('\n').trim();
};

const parseCsv = async (file) => {
  const rawText = await file.text();
  const csvText = stripPreambleAndFooter(rawText);

  return new Promise((resolve, reject) => {
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => String(header || '').trim(),
      complete: (results) => {
        const errors = results.errors || [];
        const fatalErrors = errors.filter((err) => {
          if (err?.type === 'Quotes') return false;
          if (err?.code === 'TooManyFields' || err?.code === 'TooFewFields') return false;
          return true;
        });

        if (fatalErrors.length > 0) {
          reject(new Error(fatalErrors[0].message || 'Failed to parse CSV.'));
          return;
        }

        resolve(results);
      },
      error: (error) => reject(error),
    });
  });
};

const detectFileType = (headers, fileName) => {
  const h = new Set((headers || []).map((x) => String(x || '').trim().toLowerCase()));
  const lowerFile = String(fileName || '').toLowerCase();

  const hasDate = h.has('date');
  const hasDescription = h.has('description');
  const hasAmount = h.has('amount (in $)') || h.has('amount') || h.has('amount ($)');
  const hasAccount = h.has('account name') || h.has('account');

  if ((hasDate && hasDescription && hasAmount) || lowerFile.includes('transactions')) {
    return 'fidelity-transactions';
  }

  if ((h.has('run date') && h.has('action') && h.has('amount ($)')) || lowerFile.includes('history')) {
    return 'fidelity-account-history';
  }

  return 'unknown';
};

const cleanRows = (rows) => {
  return rows.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    const values = Object.values(row).map((v) => String(v ?? '').trim());
    if (values.every((v) => v === '')) return false;
    if (values.join(' ').toLowerCase().startsWith('total records')) return false;
    if (values.join(' ').toLowerCase().includes('disclaimer')) return false;
    return true;
  });
};

const mapFidelityTransactionRows = (rows, fileName) => {
  const mapped = [];

  rows.forEach((row) => {
    const date = parseDateToIso(row.Date || row['Run Date']);
    const description = String(row.Description || '').trim();
    const amount = parseAmount(row['Amount (in $)'] ?? row.Amount ?? row['Amount ($)']);
    const account = String(row['Account Name'] ?? row.Account ?? '').trim();
    const category = String(row.Category ?? row.Type ?? 'Uncategorized').trim() || 'Uncategorized';

    if (!date || !description || amount === null || !account) return;
    if (EXCLUDED_ACCOUNTS.has(account)) return;

    mapped.push({
      date,
      description,
      amount,
      account,
      category,
      source_file: fileName,
      manual_override: null,
      dedupe_group_key: `import-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      dedupe_source_amount: amount,
      dedupe_source_date: date,
      split_parent_id: null,
    });
  });

  return mapped;
};

export async function importCsvToDatabase(file, db) {
  if (!file) throw new Error('No CSV file selected.');
  if (!db) throw new Error('Database is not initialized.');

  await bootstrapSchema(db);
  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_transactions_date_desc_amount
    ON transactions (date, description, amount);
  `);

  const parsed = await parseCsv(file);
  const headers = parsed.meta?.fields || [];
  const fileType = detectFileType(headers, file.name);

  if (fileType === 'unknown') {
    throw new Error('Unsupported CSV format. Please upload a Fidelity transactions CSV.');
  }

  const rows = cleanRows(parsed.data || []);
  const mappedRows = mapFidelityTransactionRows(rows, file.name);

  if (mappedRows.length === 0) {
    return { fileType, inserted: 0, duplicates: 0, total: 0 };
  }

  const activeRules = await getRules(db, { activeOnly: true });
  const plannedRows = applyRulesToImportedTransactions(mappedRows, activeRules);

  const insertTransactionRow = async (tx) => {
    await db.exec(`
      INSERT OR IGNORE INTO transactions (
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
        ${toSql(tx.date)},
        ${toSql(tx.description)},
        ${toSql(tx.amount)},
        ${toSql(tx.account)},
        ${toSql(tx.category)},
        ${toSql(tx.source_file)},
        ${toSql(tx.manual_override)},
        ${toSql(tx.dedupe_group_key)},
        ${toSql(tx.dedupe_source_amount)},
        ${toSql(tx.dedupe_source_date)},
        ${toSql(tx.split_parent_id)},
        ${toSql(tx.is_hidden ?? 0)}
      );
    `);

    const result = await db.exec('SELECT changes() AS changed;');
    return Number(result?.[0]?.values?.[0]?.[0] ?? 0);
  };

  await db.exec('BEGIN TRANSACTION;');
  let transactionCommitted = false;
  try {
    let inserted = 0;

    for (const plan of plannedRows) {
      if (plan.kind === 'split') {
        const parentChanged = await insertTransactionRow(plan.parent);
        if (parentChanged === 0) {
          continue;
        }

        inserted += 1;
        const parentIdResult = await db.exec('SELECT last_insert_rowid() AS id;');
        const parentId = Number(parentIdResult?.[0]?.values?.[0]?.[0] ?? 0);

        for (const child of plan.children) {
          await insertTransactionRow({
            ...child,
            split_parent_id: parentId,
          });
        }
        continue;
      }

      const changed = await insertTransactionRow(plan.transaction);
      if (changed > 0) inserted += 1;
    }

    await db.exec('COMMIT;');
    transactionCommitted = true;
    await saveDbToBrowser(db);
    return {
      fileType,
      total: mappedRows.length,
      inserted,
      duplicates: mappedRows.length - inserted,
    };
  } catch (error) {
    if (!transactionCommitted) {
      await db.exec('ROLLBACK;');
    }
    throw error;
  }
}