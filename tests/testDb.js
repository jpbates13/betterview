import { vi } from 'vitest';
import initSqlJs from 'sql.js';

// Browser storage isn't available under Node; keep it in memory.
vi.mock('localforage', () => {
  const store = new Map();
  return {
    default: {
      setItem: async (key, value) => { store.set(key, value); return value; },
      getItem: async (key) => store.get(key) ?? null,
      removeItem: async (key) => { store.delete(key); },
    },
  };
});

const SQL = await initSqlJs();

// Same shape as the worker-backed api in DatabaseContext.
export function makeDb(bytes) {
  const raw = bytes ? new SQL.Database(bytes) : new SQL.Database();
  return {
    raw,
    exec: async (sql, params) => (params ? raw.exec(sql, params) : raw.exec(sql)),
    export: async () => raw.export(),
  };
}

export const csvFile = (text, name = 'transactions.csv') => ({ name, text: async () => text });

export const visibleRows = (db, where = '1 = 1') => {
  const result = db.raw.exec(`SELECT description, amount, category FROM transactions WHERE is_hidden = 0 AND ${where} ORDER BY id`);
  return result[0]?.values ?? [];
};
