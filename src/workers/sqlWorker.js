import initSqlJs from 'sql.js';

let SQL = null;
let db = null;

const postSuccess = (id, data = {}, transfer = []) => {
  self.postMessage({ id, ok: true, data }, transfer);
};

const postError = (id, error) => {
  self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
};

const ensureSql = async () => {
  if (!SQL) {
    SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
  }
};

const setDatabase = (bytes) => {
  if (db) {
    db.close();
  }

  db = bytes ? new SQL.Database(bytes) : new SQL.Database();
};

self.onmessage = async (event) => {
  const { id, action, payload } = event.data || {};

  try {
    if (!id || !action) {
      throw new Error('Invalid worker message payload.');
    }

    await ensureSql();

    if (action === 'init') {
      setDatabase(payload?.buffer ? new Uint8Array(payload.buffer) : null);
      postSuccess(id, { ready: true, loaded: Boolean(payload?.buffer) });
      return;
    }

    if (action === 'new') {
      setDatabase(null);
      postSuccess(id, { ready: true });
      return;
    }

    if (action === 'load') {
      if (!payload?.buffer) {
        throw new Error('Missing SQLite file buffer.');
      }

      setDatabase(new Uint8Array(payload.buffer));
      postSuccess(id, { loaded: true });
      return;
    }

    if (!db) {
      throw new Error('Database is not initialized.');
    }

    if (action === 'exec') {
      const sql = payload?.sql;
      if (!sql || typeof sql !== 'string') {
        throw new Error('Missing SQL statement.');
      }
      const results = db.exec(sql);
      postSuccess(id, { results });
      return;
    }

    if (action === 'export') {
      const bytes = db.export();
      postSuccess(id, { bytes }, [bytes.buffer]);
      return;
    }

    throw new Error(`Unsupported action: ${action}`);
  } catch (error) {
    postError(id, error);
  }
};
