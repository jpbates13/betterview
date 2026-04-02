const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_FILE_NAME = 'betterview_transactions.db';

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
    fields: 'files(id,name,modifiedTime)',
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

export async function downloadDbFromDrive(accessToken) {
  if (!accessToken) {
    throw new Error('Missing Google Drive access token.');
  }

  const file = await findDriveDbFile(accessToken);
  if (!file?.id) {
    return null;
  }

  const response = await fetch(`${DRIVE_API_BASE}/${file.id}?alt=media`, {
    method: 'GET',
    headers: {
      ...authHeaders(accessToken),
    },
  });

  await ensureOk(response, 'Drive DB download');
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

export async function uploadDbToDrive(accessToken, dbUint8Array) {
  if (!accessToken) {
    throw new Error('Missing Google Drive access token.');
  }
  if (!(dbUint8Array instanceof Uint8Array)) {
    throw new Error('uploadDbToDrive expected a Uint8Array database payload.');
  }

  const file = await findDriveDbFile(accessToken);

  if (file?.id) {
    const updateResponse = await fetch(`${DRIVE_UPLOAD_BASE}/${file.id}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        ...authHeaders(accessToken),
        'Content-Type': 'application/x-sqlite3',
      },
      body: dbUint8Array,
    });

    await ensureOk(updateResponse, 'Drive DB update');
    return updateResponse.json();
  }

  const boundary = `betterview-boundary-${Date.now()}`;
  const metadataPart =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify({ name: DRIVE_FILE_NAME })}\r\n`;

  const fileHeaderPart =
    `--${boundary}\r\n` +
    'Content-Type: application/x-sqlite3\r\n\r\n';

  const closingPart = `\r\n--${boundary}--`;

  const multipartBody = new Blob([
    metadataPart,
    fileHeaderPart,
    dbUint8Array,
    closingPart,
  ], { type: `multipart/related; boundary=${boundary}` });

  const createResponse = await fetch(`${DRIVE_UPLOAD_BASE}?uploadType=multipart`, {
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
