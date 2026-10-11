import localforage from 'localforage';

// Optional encryption of the copy kept in Google Drive. The browser copy stays plain.
// File layout: "BVENC1" magic, 16-byte PBKDF2 salt, 12-byte AES-GCM IV, ciphertext.
const MAGIC = new TextEncoder().encode('BVENC1');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const PBKDF2_ITERATIONS = 310000;
const KEY_STORAGE_KEY = 'betterview_drive_encryption';

export class PassphraseRequiredError extends Error {
  constructor(encryptedBytes, message = 'This Drive copy is encrypted. Enter your passphrase to open it.') {
    super(message);
    this.name = 'PassphraseRequiredError';
    this.encryptedBytes = encryptedBytes;
  }
}

export const isEncrypted = (bytes) => (
  bytes instanceof Uint8Array
  && bytes.length > MAGIC.length + SALT_BYTES + IV_BYTES
  && MAGIC.every((byte, index) => bytes[index] === byte)
);

const saltOf = (bytes) => bytes.slice(MAGIC.length, MAGIC.length + SALT_BYTES);

export async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// The derived key is stored non-extractable in IndexedDB, so the passphrase is entered once per device.
export async function loadEncryptionKey() {
  try {
    const stored = await localforage.getItem(KEY_STORAGE_KEY);
    return stored?.key && stored?.salt ? stored : null;
  } catch {
    return null;
  }
}

const storeEncryptionKey = (key, salt) => localforage.setItem(KEY_STORAGE_KEY, { key, salt });

export const clearEncryptionKey = () => localforage.removeItem(KEY_STORAGE_KEY);

export async function enableEncryption(passphrase) {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('Use a passphrase of at least 8 characters.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  await storeEncryptionKey(await deriveKey(passphrase, salt), salt);
}

export async function encryptBytes(bytes, stored) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, stored.key, bytes));
  const out = new Uint8Array(MAGIC.length + SALT_BYTES + IV_BYTES + cipher.length);
  out.set(MAGIC, 0);
  out.set(stored.salt, MAGIC.length);
  out.set(iv, MAGIC.length + SALT_BYTES);
  out.set(cipher, MAGIC.length + SALT_BYTES + IV_BYTES);
  return out;
}

const decryptWithKey = async (bytes, key) => {
  const ivStart = MAGIC.length + SALT_BYTES;
  const iv = bytes.slice(ivStart, ivStart + IV_BYTES);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.slice(ivStart + IV_BYTES));
  return new Uint8Array(plain);
};

const sameBytes = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

// Returns plain bytes. Throws PassphraseRequiredError when this device has no matching key.
export async function decryptIfNeeded(bytes) {
  if (!isEncrypted(bytes)) return bytes;
  const stored = await loadEncryptionKey();
  if (stored && sameBytes(new Uint8Array(stored.salt), saltOf(bytes))) {
    try {
      return await decryptWithKey(bytes, stored.key);
    } catch {
      // Fall through: the passphrase was changed on another device.
    }
  }
  throw new PassphraseRequiredError(bytes);
}

// Unlocks an encrypted Drive copy with a passphrase and remembers the key on this device.
export async function unlockWithPassphrase(bytes, passphrase) {
  const salt = saltOf(bytes);
  const key = await deriveKey(passphrase, salt);
  let plain;
  try {
    plain = await decryptWithKey(bytes, key);
  } catch {
    throw new PassphraseRequiredError(bytes, 'That passphrase did not open the Drive copy. Try again.');
  }
  await storeEncryptionKey(key, salt);
  return plain;
}

// Encrypts for upload when this device has encryption turned on.
export async function prepareForUpload(bytes) {
  const stored = await loadEncryptionKey();
  return stored ? encryptBytes(bytes, stored) : bytes;
}
