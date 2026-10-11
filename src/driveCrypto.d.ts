export interface StoredEncryptionKey {
  key: CryptoKey;
  salt: Uint8Array;
}

export class PassphraseRequiredError extends Error {
  constructor(encryptedBytes: Uint8Array, message?: string);
  encryptedBytes: Uint8Array;
}

export const isEncrypted: (bytes: unknown) => boolean;
export function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey>;
export function loadEncryptionKey(): Promise<StoredEncryptionKey | null>;
export const clearEncryptionKey: () => Promise<void>;
export function enableEncryption(passphrase: string): Promise<void>;
export function encryptBytes(bytes: Uint8Array, stored: StoredEncryptionKey): Promise<Uint8Array>;
export function decryptIfNeeded(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
export function unlockWithPassphrase(bytes: Uint8Array, passphrase: string): Promise<Uint8Array<ArrayBuffer>>;
export function prepareForUpload(bytes: Uint8Array): Promise<Uint8Array>;
