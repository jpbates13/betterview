import localforage from 'localforage';

const DB_STORAGE_KEY = 'betterview_local_db';

const normalizeBinary = async (value) => {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }
  return null;
};

const exportAndStore = async (db) => {
  const exported = await db.export();
  const data = await normalizeBinary(exported);
  if (!data) {
    throw new Error('Failed to export database bytes.');
  }
  await localforage.setItem(DB_STORAGE_KEY, data);
  return data;
};

// Each save exports the whole database, so overlapping saves share work: while one
// runs, every later request waits for a single follow-up save that starts after it.
const saveStates = new WeakMap();

export function saveDbToBrowser(db) {
  if (!db || typeof db.export !== 'function') {
    return Promise.reject(new Error('Database is not available for export.'));
  }

  let state = saveStates.get(db);
  if (!state) {
    state = { running: null, queued: null };
    saveStates.set(db, state);
  }

  const run = () => {
    const current = exportAndStore(db).finally(() => {
      if (state.running === current) state.running = null;
    });
    state.running = current;
    return current;
  };

  if (state.queued) return state.queued;
  if (state.running) {
    state.queued = state.running.catch(() => {}).then(() => {
      state.queued = null;
      return run();
    });
    return state.queued;
  }
  return run();
}

export async function loadDbFromBrowser() {
  const data = await normalizeBinary(await localforage.getItem(DB_STORAGE_KEY));
  return data || null;
}

export async function saveDbBytesToBrowser(bytes) {
  const data = await normalizeBinary(bytes);
  if (!data) {
    throw new Error('Failed to persist provided database bytes.');
  }

  await localforage.setItem(DB_STORAGE_KEY, data);
  return data;
}

export async function clearDbFromBrowser() {
  await localforage.removeItem(DB_STORAGE_KEY);
}

const DB_OWNER_STORAGE_KEY = 'betterview_local_db_owner';

// Google account id whose data the browser-saved DB currently holds.
export async function loadDbOwnerFromBrowser() {
  const owner = await localforage.getItem(DB_OWNER_STORAGE_KEY);
  return owner ? String(owner) : null;
}

export async function saveDbOwnerToBrowser(owner) {
  await localforage.setItem(DB_OWNER_STORAGE_KEY, String(owner));
}
