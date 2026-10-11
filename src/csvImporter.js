import Papa from 'papaparse';
import { applyRulesToImportedTransactions, bootstrapSchema, ensureDedupeIndex, getRules } from './dbQueries.js';
import { getMerchantRules } from './db/merchants-store.js';
import { resolveMerchant } from './db/merchants.js';
import { binds, changes, inTransaction, lastInsertId, normalizeText, queryRows, randomKey } from './db/sql.js';
import { saveDbToBrowser } from './dbStorage.js';

// ── Amounts and dates ────────────────────────────────────────────────────────

export const parseAmount = (value) => {
  if (value === null || value === undefined) return null;
  let cleaned = String(value).replace(/[$,\s]/g, '').trim();
  if (!cleaned) return null;

  // Accounting style negatives: (12.34)
  const isParenthesized = /^\(.*\)$/.test(cleaned);
  if (isParenthesized) cleaned = cleaned.slice(1, -1);

  // Trailing minus or CR/DR markers: 12.34- / 12.34CR
  let sign = isParenthesized ? -1 : 1;
  if (/-$/.test(cleaned)) {
    sign = -1;
    cleaned = cleaned.slice(0, -1);
  }
  if (/dr$/i.test(cleaned)) {
    sign = -1;
    cleaned = cleaned.slice(0, -2);
  } else if (/cr$/i.test(cleaned)) {
    cleaned = cleaned.slice(0, -2);
  }

  const num = Number(cleaned);
  return Number.isFinite(num) ? sign * num : null;
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export const DATE_FORMATS = [
  { value: 'auto', label: 'Detect (US month first)' },
  { value: 'MDY', label: 'MM/DD/YYYY' },
  { value: 'DMY', label: 'DD/MM/YYYY' },
  { value: 'YMD', label: 'YYYY-MM-DD' },
];

const toIso = (year, month, day) => {
  const y = Number(year.length === 2 ? `20${year}` : year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

// Parses only formats we can read unambiguously; never falls back to the
// locale-dependent `new Date(string)`. Returns null for anything else.
export const parseDateToIso = (value, format = 'auto') => {
  const raw = normalizeText(value).replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[ap]m)?$/i, '');
  if (!raw) return null;

  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) return toIso(match[1], match[2], match[3]);

  match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (match) {
    const [, first, second, year] = match;
    if (format === 'DMY') return toIso(year, second, first);
    if (format === 'MDY') return toIso(year, first, second);
    // auto: month first unless that is impossible.
    return Number(first) > 12 ? toIso(year, second, first) : toIso(year, first, second);
  }

  // "Mar 4, 2026", "4 Mar 2026", "March 04 2026"
  match = raw.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (match) {
    const month = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
    return month ? toIso(match[3], String(month), match[2]) : null;
  }
  match = raw.match(/^(\d{1,2})[\s-]([A-Za-z]{3,})[\s-](\d{4})$/);
  if (match) {
    const month = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase()) + 1;
    return month ? toIso(match[3], String(month), match[1]) : null;
  }

  return null;
};

// ── CSV parsing ──────────────────────────────────────────────────────────────

const stripPreambleAndFooter = (rawText) => {
  const lines = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  while (lines.length > 0 && lines[0].trim() === '') {
    lines.shift();
  }

  // Drop title lines above the header row (the first line with at least two commas).
  while (lines.length > 1) {
    const firstLine = lines[0].trim();
    const looksLikeTitle = /spending transactions|accounts history/i.test(firstLine);
    if ((firstLine.match(/,/g) || []).length >= 2 && !looksLikeTitle) break;
    lines.shift();
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

const cleanRows = (rows) => rows.filter((row) => {
  if (!row || typeof row !== 'object') return false;
  const values = Object.values(row).map((v) => String(v ?? '').trim());
  if (values.every((v) => v === '')) return false;
  const joined = values.join(' ').toLowerCase();
  if (joined.startsWith('total records')) return false;
  if (joined.includes('disclaimer')) return false;
  return true;
});

export async function parseCsvFile(file) {
  const rawText = await file.text();
  const csvText = stripPreambleAndFooter(rawText);

  const results = await new Promise((resolve, reject) => {
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => String(header || '').trim(),
      complete: resolve,
      error: reject,
    });
  });

  const fatalErrors = (results.errors || []).filter((err) => (
    err?.type !== 'Quotes' && err?.code !== 'TooManyFields' && err?.code !== 'TooFewFields'
  ));
  if (fatalErrors.length > 0) {
    throw new Error(`Could not read the CSV: ${fatalErrors[0].message} (row ${fatalErrors[0].row ?? '?'})`);
  }

  const headers = (results.meta?.fields || []).filter(Boolean);
  return { headers, rows: cleanRows(results.data || []) };
}

// ── Column mapping profiles ──────────────────────────────────────────────────
//
// A profile says which CSV column holds each field:
// { name, date, dateFormat, description, amount, debit, credit, invertAmount,
//   account, defaultAccount, category, headers }
// Either `amount`, or `debit`/`credit`, must be set. Amounts are stored with
// expenses negative; `invertAmount` flips files that show spending as positive.

const findHeader = (headers, candidates) => {
  const lower = headers.map((h) => h.toLowerCase());
  for (const candidate of candidates) {
    const index = lower.indexOf(candidate);
    if (index >= 0) return headers[index];
  }
  return null;
};

export const FIDELITY_PROFILE_NAME = 'Fidelity (built-in)';

const fidelityProfile = (headers) => ({
  name: FIDELITY_PROFILE_NAME,
  date: findHeader(headers, ['date', 'run date']),
  dateFormat: 'auto',
  description: findHeader(headers, ['description', 'action']),
  amount: findHeader(headers, ['amount (in $)', 'amount ($)', 'amount']),
  debit: null,
  credit: null,
  invertAmount: false,
  account: findHeader(headers, ['account name', 'account']),
  defaultAccount: '',
  category: findHeader(headers, ['category', 'type']),
});

const isFidelityFile = (headers) => {
  const h = new Set(headers.map((x) => x.toLowerCase()));
  const hasAmount = h.has('amount (in $)') || h.has('amount ($)');
  const isTransactions = h.has('date') && h.has('description') && (hasAmount || h.has('amount')) && (h.has('account') || h.has('account name'));
  const isHistory = h.has('run date') && h.has('action') && h.has('amount ($)');
  return isTransactions || isHistory;
};

// Suggests a mapping for an unknown file from common header names, for the mapping screen.
export const guessProfile = (headers) => ({
  name: '',
  date: findHeader(headers, ['date', 'transaction date', 'posted date', 'posting date', 'trans. date', 'run date']),
  dateFormat: 'auto',
  description: findHeader(headers, ['description', 'payee', 'merchant', 'name', 'memo', 'details']),
  amount: findHeader(headers, ['amount', 'amount (in $)', 'amount ($)', 'transaction amount']),
  debit: findHeader(headers, ['debit', 'withdrawal', 'withdrawals', 'debit amount']),
  credit: findHeader(headers, ['credit', 'deposit', 'deposits', 'credit amount']),
  invertAmount: false,
  account: findHeader(headers, ['account', 'account name', 'card', 'account number']),
  defaultAccount: '',
  category: findHeader(headers, ['category', 'type']),
  headers,
});

export const validateProfile = (profile) => {
  if (!profile?.date) return 'Choose the date column.';
  if (!profile.description) return 'Choose the description column.';
  if (!profile.amount && !profile.debit && !profile.credit) return 'Choose an amount column, or debit/credit columns.';
  if (!profile.account && !normalizeText(profile.defaultAccount)) return 'Choose the account column or type an account name.';
  return null;
};

const profileFitsHeaders = (profile, headers) => {
  const set = new Set(headers);
  return ['date', 'description', 'amount', 'debit', 'credit', 'account', 'category']
    .map((key) => profile[key])
    .filter(Boolean)
    .every((column) => set.has(column));
};

export async function getCsvProfiles(db) {
  await bootstrapSchema(db);
  const rows = await queryRows(db, 'SELECT id, name, mapping FROM csv_profiles ORDER BY name;');
  return rows.map((row) => ({ ...JSON.parse(row.mapping), id: Number(row.id), name: row.name }));
}

export async function saveCsvProfile(db, profile) {
  await bootstrapSchema(db);
  const name = normalizeText(profile.name);
  if (!name) throw new Error('Give this format a name so it can be reused.');
  const { id: _id, ...mapping } = profile;
  await db.exec(
    'INSERT INTO csv_profiles (name, mapping) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET mapping = excluded.mapping;',
    binds(name, JSON.stringify({ ...mapping, name })),
  );
  await saveDbToBrowser(db);
}

export async function deleteCsvProfile(db, profileId) {
  await db.exec('DELETE FROM csv_profiles WHERE id = ?;', binds(profileId));
  await saveDbToBrowser(db);
}

// Picks the profile for a file: a saved profile whose columns all exist, then Fidelity.
export async function detectProfile(db, headers) {
  const saved = await getCsvProfiles(db);
  const exact = saved.find((profile) => (
    Array.isArray(profile.headers)
    && profile.headers.length === headers.length
    && profile.headers.every((header, index) => header === headers[index])
  ));
  if (exact) return exact;
  if (isFidelityFile(headers)) return fidelityProfile(headers);
  return saved.find((profile) => profileFitsHeaders(profile, headers)) || null;
}

// ── Row mapping ──────────────────────────────────────────────────────────────

export function mapRows(rows, profile, fileName) {
  const mapped = [];
  const skipped = [];

  rows.forEach((row, index) => {
    const lineNumber = index + 2; // header is line 1
    const rawDate = row[profile.date];
    const date = parseDateToIso(rawDate, profile.dateFormat || 'auto');
    const description = normalizeText(row[profile.description]);
    const account = normalizeText(profile.account ? row[profile.account] : '') || normalizeText(profile.defaultAccount);
    const category = normalizeText(profile.category ? row[profile.category] : '') || 'Uncategorized';

    let amount = null;
    if (profile.amount) {
      amount = parseAmount(row[profile.amount]);
    } else {
      const debit = parseAmount(row[profile.debit]);
      const credit = parseAmount(row[profile.credit]);
      if (debit !== null || credit !== null) {
        amount = (credit ? Math.abs(credit) : 0) - (debit ? Math.abs(debit) : 0);
      }
    }
    if (amount !== null && profile.invertAmount) amount = -amount;

    const reason = !date
      ? `unreadable date "${normalizeText(rawDate)}"`
      : !description ? 'no description'
        : amount === null ? 'no amount'
          : !account ? 'no account' : null;
    if (reason) {
      skipped.push({ line: lineNumber, reason });
      return;
    }

    mapped.push({
      date,
      description,
      amount,
      account,
      category,
      source_file: fileName,
      manual_override: null,
      dedupe_group_key: randomKey('import'),
      dedupe_source_amount: amount,
      dedupe_source_date: date,
      split_parent_id: null,
    });
  });

  // Number identical rows within the file so genuine repeats (two coffees) survive dedupe.
  const seen = new Map();
  for (const tx of mapped) {
    const key = `${tx.date}\u0000${tx.description}\u0000${tx.amount}`;
    const seq = seen.get(key) ?? 0;
    tx.dedupe_seq = seq;
    seen.set(key, seq + 1);
  }

  return { mapped, skipped };
}

export class CsvMappingRequiredError extends Error {
  constructor(headers, sampleRows) {
    super('This CSV format is not recognized yet. Map its columns to import it.');
    this.name = 'CsvMappingRequiredError';
    this.headers = headers;
    this.sampleRows = sampleRows;
  }
}

// ── Import ───────────────────────────────────────────────────────────────────

const INSERT_COLUMNS = [
  'date', 'description', 'amount', 'account', 'category', 'source_file', 'manual_override',
  'dedupe_group_key', 'dedupe_source_amount', 'dedupe_source_date', 'split_parent_id', 'is_hidden',
  'dedupe_seq', 'import_batch_id', 'applied_rule_id', 'merchant',
];

const insertTransactionRow = async (db, tx) => {
  await db.exec(
    `INSERT OR IGNORE INTO transactions (${INSERT_COLUMNS.join(', ')})
     VALUES (${INSERT_COLUMNS.map(() => '?').join(', ')});`,
    binds(...INSERT_COLUMNS.map((column) => (column === 'is_hidden' ? tx.is_hidden ?? 0 : tx[column] ?? null))),
  );
  return changes(db);
};

/**
 * Imports a CSV. Without `options.profile` the format is detected; an unknown
 * format throws CsvMappingRequiredError carrying the headers for the mapping screen.
 */
export async function importCsvToDatabase(file, db, options = {}) {
  if (!file) throw new Error('No CSV file selected.');
  if (!db) throw new Error('Database is not initialized.');

  await bootstrapSchema(db);
  await ensureDedupeIndex(db);

  const { headers, rows } = await parseCsvFile(file);
  if (headers.length === 0) {
    throw new Error('The CSV has no header row.');
  }

  const profile = options.profile || await detectProfile(db, headers);
  if (!profile) {
    throw new CsvMappingRequiredError(headers, rows.slice(0, 5));
  }
  const profileError = validateProfile(profile);
  if (profileError) throw new Error(profileError);

  const { mapped, skipped } = mapRows(rows, profile, file.name);
  const batchId = randomKey('batch');
  const summary = {
    batchId,
    fileName: file.name,
    profileName: profile.name,
    total: mapped.length,
    inserted: 0,
    duplicates: 0,
    categorizedByRules: 0,
    splitByRules: 0,
    skipped,
    insertedIds: [],
  };

  if (mapped.length === 0) {
    return summary;
  }

  const merchantRules = await getMerchantRules(db);
  for (const tx of mapped) {
    tx.merchant = resolveMerchant(tx.description, merchantRules);
    tx.import_batch_id = batchId;
  }

  const activeRules = await getRules(db, { activeOnly: true });
  const plannedRows = applyRulesToImportedTransactions(mapped, activeRules);

  await inTransaction(db, async () => {
    for (const plan of plannedRows) {
      if (plan.kind === 'split') {
        if (await insertTransactionRow(db, plan.parent) === 0) {
          summary.duplicates += 1;
          continue;
        }

        summary.inserted += 1;
        summary.splitByRules += 1;
        const parentId = await lastInsertId(db);
        summary.insertedIds.push(parentId);

        for (const child of plan.children) {
          await insertTransactionRow(db, { ...child, split_parent_id: parentId });
          summary.insertedIds.push(await lastInsertId(db));
        }
        continue;
      }

      if (await insertTransactionRow(db, plan.transaction) > 0) {
        summary.inserted += 1;
        summary.insertedIds.push(await lastInsertId(db));
        if (plan.transaction.applied_rule_id) summary.categorizedByRules += 1;
      } else {
        summary.duplicates += 1;
      }
    }

    await db.exec(
      `INSERT INTO import_batches (id, file_name, profile_name, imported_at, inserted_count, duplicate_count)
       VALUES (?, ?, ?, ?, ?, ?);`,
      binds(batchId, file.name, profile.name, new Date().toISOString(), summary.inserted, summary.duplicates),
    );
  });

  await saveDbToBrowser(db);
  return summary;
}

// ── Import history ───────────────────────────────────────────────────────────

export async function getImportBatches(db) {
  await bootstrapSchema(db);
  return queryRows(db, `
    SELECT b.id, b.file_name, b.profile_name, b.imported_at, b.inserted_count, b.duplicate_count,
           (SELECT COUNT(*) FROM transactions t WHERE t.import_batch_id = b.id AND t.is_hidden = 0) AS visible_rows
    FROM import_batches b
    ORDER BY b.imported_at DESC;
  `);
}

// Removes everything one import added, including split halves made from its rows later.
export async function undoImportBatch(db, batchId) {
  const removed = await inTransaction(db, async () => {
    const ids = `SELECT id FROM transactions WHERE import_batch_id = ?`;
    await db.exec(`DELETE FROM transaction_tags WHERE transaction_id IN (${ids}) OR transaction_id IN (SELECT id FROM transactions WHERE split_parent_id IN (${ids}));`, binds(batchId, batchId));
    await db.exec(`UPDATE transactions SET reimburses_id = NULL WHERE reimburses_id IN (${ids});`, binds(batchId));
    await db.exec(`DELETE FROM transactions WHERE split_parent_id IN (${ids});`, binds(batchId));
    const childCount = await changes(db);
    await db.exec('DELETE FROM transactions WHERE import_batch_id = ?;', binds(batchId));
    const rowCount = await changes(db);
    await db.exec('DELETE FROM import_batches WHERE id = ?;', binds(batchId));
    return rowCount + childCount;
  });

  await saveDbToBrowser(db);
  return removed;
}
