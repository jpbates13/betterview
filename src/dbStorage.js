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

export async function saveDbToBrowser(db) {
  if (!db || typeof db.export !== 'function') {
    throw new Error('Database is not available for export.');
  }

  const exported = await db.export();
  const data = await normalizeBinary(exported);
  if (!data) {
    throw new Error('Failed to export database bytes.');
  }
  await localforage.setItem(DB_STORAGE_KEY, data);
  return data;
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