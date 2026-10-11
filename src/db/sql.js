// Shared helpers for talking to the SQL.js worker.

export const rowify = (execResult) => {
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

// Runs one statement with bound `?` parameters and returns its rows as objects.
export const queryRows = async (db, sql, params) => rowify(await db.exec(sql, params));

export const scalar = async (db, sql, fallback = 0, params) => {
  const rows = await queryRows(db, sql, params);
  if (!rows.length) return fallback;
  const value = rows[0][Object.keys(rows[0])[0]];
  return value ?? fallback;
};

export const changes = async (db) => Number(await scalar(db, 'SELECT changes() AS changes_count;', 0));

export const lastInsertId = async (db) => Number(await scalar(db, 'SELECT last_insert_rowid() AS id;', 0));

// Literal SQL value, for the few places that build SQL text (generated IN lists, LIKE chains).
export const sqlValue = (value) => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  return `'${String(value).replace(/'/g, "''")}'`;
};

// Normalizes a JS value into something sql.js can bind.
export const bindValue = (value) => {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return value;
};

export const binds = (...values) => values.map(bindValue);

export const placeholders = (count) => Array.from({ length: count }, () => '?').join(', ');

export const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const round2 = (value) => Math.round(toNumber(value) * 100) / 100;

export const randomKey = (prefix) => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const normalizeText = (value) => String(value ?? '').trim();

export const normalizeLower = (value) => normalizeText(value).toLowerCase();

// Wraps `fn` in BEGIN/COMMIT, rolling back if it throws.
export const inTransaction = async (db, fn) => {
  await db.exec('BEGIN TRANSACTION;');
  try {
    const result = await fn();
    await db.exec('COMMIT;');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK;');
    throw error;
  }
};
