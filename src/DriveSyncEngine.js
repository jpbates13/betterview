const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3/files';
import { decryptIfNeeded, prepareForUpload } from './driveCrypto.js';

const DRIVE_FILE_NAME = 'betterview_transactions.db';
const BACKUP_PREFIX = 'betterview_transactions.';
const BACKUPS_TO_KEEP = 14;
const KNOWN_VERSION_STORAGE_KEY = 'betterview_drive_known_version';
const LAST_BACKUP_STORAGE_KEY = 'betterview_drive_last_backup';
const FILE_FIELDS = 'id,name,modifiedTime,version';

const readStorage = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures; conflict checks just get less precise.
  }
};

// The Drive file version this device last downloaded or uploaded. Another device's
// upload bumps the version, which is how a conflicting edit is spotted.
export const getKnownDriveVersion = () => readStorage(KNOWN_VERSION_STORAGE_KEY);
export const setKnownDriveVersion = (version) => writeStorage(KNOWN_VERSION_STORAGE_KEY, version ? String(version) : null);

export class DriveConflictError extends Error {
  constructor(cloudFile) {
    super('The Drive copy was changed on another device since this device last synced.');
    this.name = 'DriveConflictError';
    this.cloudFile = cloudFile;
  }
}

const authHeaders = (accessToken) => ({
  Authorization: `Bearer ${accessToken}`,
});

const ensureOk = async (response, action) => {
  if (response.ok) return;

  let details = '';
  try {
    details = await response.text();
  } catch {
    details = '';
  }

  throw new Error(`${action} failed (${response.status}): ${details || response.statusText}`);
};

async function findDriveDbFile(accessToken) {
  const params = new URLSearchParams({
    q: `name='${DRIVE_FILE_NAME}' and trashed=false`,
    fields: `files(${FILE_FIELDS})`,
    orderBy: 'modifiedTime desc',
    pageSize: '1',
  });

  const response = await fetch(`${DRIVE_API_BASE}?${params.toString()}`, {
    method: 'GET',
    headers: {
      ...authHeaders(accessToken),
    },
  });

  await ensureOk(response, 'Drive file lookup');
  const payload = await response.json();
  const file = payload?.files?.[0];
  return file || null;
}

// Stable id for the signed-in Google account, used to tell whose data the local DB holds.
export async function getDriveUserId(accessToken) {
  if (!accessToken) {
    throw new Error('Missing Google Drive access token.');
  }

  const response = await fetch(`https://www.googleapis.com/drive/v3/about?fields=user(permissionId)`, {
    method: 'GET',
    headers: {
      ...authHeaders(accessToken),
    },
  });

  await ensureOk(response, 'Drive account lookup');
  const payload = await response.json();
  const userId = payload?.user?.permissionId;
  if (!userId) {
    throw new Error('Drive account lookup returned no user id.');
  }
  return String(userId);
}

const downloadFileBytes = async (accessToken, fileId) => {
  const response = await fetch(`${DRIVE_API_BASE}/${fileId}?alt=media`, {
    method: 'GET',
    headers: {
      ...authHeaders(accessToken),
    },
  });

  await ensureOk(response, 'Drive DB download');
  return new Uint8Array(await response.arrayBuffer());
};

// Returns the plain DB bytes, or null when Drive has no copy yet. Throws
// PassphraseRequiredError (driveCrypto.js) when the copy is encrypted and this
// device has no key; pass the passphrase-unlocked bytes to acceptCloudVersion after.
export async function downloadDbFromDrive(accessToken) {
  if (!accessToken) {
    throw new Error('Missing Google Drive access token.');
  }

  const file = await findDriveDbFile(accessToken);
  if (!file?.id) {
    return null;
  }

  const bytes = await downloadFileBytes(accessToken, file.id);
  const plain = await decryptIfNeeded(bytes).catch((error) => {
    error.cloudVersion = file.version;
    throw error;
  });
  setKnownDriveVersion(file.version);
  return plain;
}

// Uploads the DB. Unless `force` is set, refuses with DriveConflictError when the
// Drive copy changed since this device last saw it.
export async function uploadDbToDrive(accessToken, dbUint8Array, { force = false } = {}) {
  if (!accessToken) {
    throw new Error('Missing Google Drive access token.');
  }
  if (!(dbUint8Array instanceof Uint8Array)) {
    throw new Error('uploadDbToDrive expected a Uint8Array database payload.');
  }

  const file = await findDriveDbFile(accessToken);
  const knownVersion = getKnownDriveVersion();
  if (file?.id && !force && knownVersion && String(file.version) !== knownVersion) {
    throw new DriveConflictError(file);
  }

  const payload = await prepareForUpload(dbUint8Array);
  let saved;

  if (file?.id) {
    // Snapshot the copy we're about to overwrite, once a day.
    await keepDailyBackup(accessToken, file).catch((error) => {
      console.error('Drive backup copy failed:', error);
    });

    const updateResponse = await fetch(`${DRIVE_UPLOAD_BASE}/${file.id}?uploadType=media&fields=${FILE_FIELDS}`, {
      method: 'PATCH',
      headers: {
        ...authHeaders(accessToken),
        'Content-Type': 'application/x-sqlite3',
      },
      body: payload,
    });

    await ensureOk(updateResponse, 'Drive DB update');
    saved = await updateResponse.json();
  } else {
    saved = await createDriveFile(accessToken, DRIVE_FILE_NAME, payload);
  }

  setKnownDriveVersion(saved?.version);
  return saved;
}

async function createDriveFile(accessToken, name, bytes) {
  const boundary = `betterview-boundary-${Date.now()}`;
  const metadataPart =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify({ name })}\r\n`;

  const fileHeaderPart =
    `--${boundary}\r\n` +
    'Content-Type: application/x-sqlite3\r\n\r\n';

  const closingPart = `\r\n--${boundary}--`;

  const multipartBody = new Blob([
    metadataPart,
    fileHeaderPart,
    bytes,
    closingPart,
  ], { type: `multipart/related; boundary=${boundary}` });

  const createResponse = await fetch(`${DRIVE_UPLOAD_BASE}?uploadType=multipart&fields=${FILE_FIELDS}`, {
    method: 'POST',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  await ensureOk(createResponse, 'Drive DB create');
  return createResponse.json();
}

const today = () => new Date().toISOString().slice(0, 10);

// Lists the dated backup copies, newest first.
export async function listDriveBackups(accessToken) {
  const params = new URLSearchParams({
    q: `name contains '${BACKUP_PREFIX}' and name != '${DRIVE_FILE_NAME}' and trashed=false`,
    fields: 'files(id,name,modifiedTime,size)',
    orderBy: 'name desc',
    pageSize: '100',
  });
  const response = await fetch(`${DRIVE_API_BASE}?${params.toString()}`, {
    method: 'GET',
    headers: authHeaders(accessToken),
  });
  await ensureOk(response, 'Drive backup list');
  const payload = await response.json();
  return (payload?.files || []).filter((file) => /^betterview_transactions\.\d{4}-\d{2}-\d{2}\.db$/.test(file.name));
}

// Before the first upload of each day, copies the Drive file to a dated backup (the
// state as of that morning) and keeps only the newest BACKUPS_TO_KEEP, so a bad
// import or sync can be rolled back.
async function keepDailyBackup(accessToken, savedFile) {
  const day = today();
  if (!savedFile?.id || readStorage(LAST_BACKUP_STORAGE_KEY) === day) return;

  const backups = await listDriveBackups(accessToken);
  const backupName = `${BACKUP_PREFIX}${day}.db`;
  if (!backups.some((file) => file.name === backupName)) {
    const response = await fetch(`${DRIVE_API_BASE}/${savedFile.id}/copy?fields=id,name,modifiedTime`, {
      method: 'POST',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: backupName }),
    });
    await ensureOk(response, 'Drive backup copy');
    backups.unshift(await response.json());
  }

  const stale = backups
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(BACKUPS_TO_KEEP);
  for (const file of stale) {
    const response = await fetch(`${DRIVE_API_BASE}/${file.id}`, {
      method: 'DELETE',
      headers: authHeaders(accessToken),
    });
    if (!response.ok && response.status !== 404) await ensureOk(response, 'Drive backup cleanup');
  }
  writeStorage(LAST_BACKUP_STORAGE_KEY, day);
}

// Downloads one dated backup as plain DB bytes (decrypting with this device's key if needed).
export async function downloadDriveBackup(accessToken, fileId) {
  return decryptIfNeeded(await downloadFileBytes(accessToken, fileId));
}
