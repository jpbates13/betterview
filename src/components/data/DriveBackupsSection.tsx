import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { History, Lock, LockOpen, RotateCcw } from 'lucide-react';
import { useDriveSync } from '../../useDriveSync';
import { useDatabase } from '../../useDatabase';
import { downloadDriveBackup, listDriveBackups } from '../../DriveSyncEngine.js';
import { clearEncryptionKey, enableEncryption, loadEncryptionKey } from '../../driveCrypto.js';
import type { DriveFile } from '../../types';

const backupDate = (name: string) => name.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? name;

// Drive's dated daily copies (restorable) and the optional encryption of the Drive copy.
export default function DriveBackupsSection() {
  const { accessToken } = useDriveSync();
  const { loadDatabaseFile, triggerMutation, notifyDataChanged } = useDatabase();
  const [backups, setBackups] = useState<DriveFile[] | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      setBackups(await listDriveBackups(accessToken));
    } catch (err) {
      setBackups([]);
      setError(err instanceof Error ? err.message : String(err));
    }
    setIsEncrypted(Boolean(await loadEncryptionKey()));
  }, [accessToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const restore = async (backup: DriveFile) => {
    const date = backupDate(backup.name);
    if (!window.confirm(`Replace all current data with the Drive backup from ${date}? Download a backup first if you might want today's data back.`)) return;
    setBusy(backup.id);
    setError('');
    setMessage('');
    try {
      const bytes = await downloadDriveBackup(accessToken, backup.id);
      await loadDatabaseFile(new File([bytes], backup.name));
      triggerMutation();
      notifyDataChanged();
      setMessage(`Restored the backup from ${date}. It will sync to Drive as the current copy.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const turnOnEncryption = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (passphrase !== confirmPassphrase) {
      setError('The two passphrases do not match.');
      return;
    }
    setBusy('encryption');
    try {
      await enableEncryption(passphrase);
      setPassphrase('');
      setConfirmPassphrase('');
      setIsEncrypted(true);
      triggerMutation();
      setMessage('Encryption is on. The next sync uploads an encrypted copy; other devices will ask for this passphrase once.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const turnOffEncryption = async () => {
    if (!window.confirm('Upload an unencrypted copy to Drive from now on?')) return;
    await clearEncryptionKey();
    setIsEncrypted(false);
    triggerMutation();
    setMessage('Encryption is off. The next sync uploads an unencrypted copy.');
  };

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 shadow-sm space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <History className="h-5 w-5 text-primary-600" /> Drive backups
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Before the first sync each day, the Drive copy is saved as a dated backup. The last 14 are kept.
        </p>
        {message && <p className="mt-3 text-sm text-emerald-700">{message}</p>}
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        <div className="mt-3 divide-y divide-gray-100 border border-gray-100 rounded-lg">
          {backups === null && <p className="p-3 text-sm text-gray-500">Loading backups…</p>}
          {backups?.length === 0 && <p className="p-3 text-sm text-gray-500">No dated backups yet. One is made the next time you sync on a new day.</p>}
          {backups?.map((backup) => (
            <div key={backup.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium text-gray-900">{backupDate(backup.name)}</div>
                {backup.size && <div className="text-xs text-gray-500">{(Number(backup.size) / 1024 / 1024).toFixed(1)} MB</div>}
              </div>
              <button
                onClick={() => restore(backup)}
                disabled={Boolean(busy)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" /> {busy === backup.id ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          {isEncrypted ? <Lock className="h-5 w-5 text-emerald-600" /> : <LockOpen className="h-5 w-5 text-gray-400" />}
          Encrypt the Drive copy
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Encrypts the file before it leaves this browser (AES-256 with a key from your passphrase), so someone with access
          to your Drive can't read your transactions. Each new device asks for the passphrase once. If you forget it, the
          Drive copy can't be opened, though this browser's copy and downloaded backups still work.
        </p>
        {isEncrypted ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-sm text-emerald-700 font-medium">Encryption is on for this device.</span>
            <button onClick={turnOffEncryption} className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm">
              Turn off
            </button>
          </div>
        ) : (
          <form onSubmit={turnOnEncryption} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Passphrase (8+ characters)"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Repeat passphrase"
              value={confirmPassphrase}
              onChange={(event) => setConfirmPassphrase(event.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <button
              type="submit"
              disabled={!passphrase || busy === 'encryption'}
              className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium disabled:opacity-50"
            >
              Turn on
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
