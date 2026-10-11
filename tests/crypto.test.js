import { describe, expect, it } from 'vitest';
import './testDb.js';
import {
  PassphraseRequiredError, clearEncryptionKey, decryptIfNeeded, enableEncryption, isEncrypted,
  prepareForUpload, unlockWithPassphrase,
} from '../src/driveCrypto.js';

describe('Drive copy encryption', () => {
  it('round-trips, and asks for the passphrase on a device without the key', async () => {
    const plain = new Uint8Array([83, 81, 76, 105, 116, 101, 1, 2, 3]);
    expect(await prepareForUpload(plain)).toBe(plain);

    await enableEncryption('correct horse battery');
    const sealed = await prepareForUpload(plain);
    expect(isEncrypted(sealed)).toBe(true);
    expect(await decryptIfNeeded(sealed)).toEqual(plain);

    await clearEncryptionKey(); // another device
    await expect(decryptIfNeeded(sealed)).rejects.toBeInstanceOf(PassphraseRequiredError);
    await expect(unlockWithPassphrase(sealed, 'wrong passphrase')).rejects.toThrow('did not open');
    expect(await unlockWithPassphrase(sealed, 'correct horse battery')).toEqual(plain);
    expect(await decryptIfNeeded(sealed)).toEqual(plain);
  });

  it('rejects short passphrases', async () => {
    await expect(enableEncryption('short')).rejects.toThrow('at least 8');
  });
});
