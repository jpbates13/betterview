import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { DatabaseBackup, Download, Upload } from 'lucide-react';
import { ErrorNote, Section, SuccessNote } from '../planning/ui';
import { downloadFile, errorMessage, primaryButtonClass, secondaryButtonClass, todayIso } from '../planning/shared';
import { useDatabase } from '../../useDatabase';

const SQLITE_HEADER = 'SQLite format 3\0';

const isSqliteFile = async (file: File) => {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (head.length < 16) return false;
  return String.fromCharCode(...head) === SQLITE_HEADER;
};

export default function BackupSection() {
  const { exportDatabase, loadDatabaseFile, triggerMutation, notifyDataChanged } = useDatabase();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'download' | 'restore' | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleDownload = async () => {
    setBusy('download');
    setError('');
    setSuccess('');
    try {
      const bytes = await exportDatabase();
      downloadFile(new Uint8Array(bytes), `betterview-${todayIso()}.db`, 'application/vnd.sqlite3');
    } catch (err) {
      setError(errorMessage(err, 'Could not create the backup.'));
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setSuccess('');
    try {
      if (!(await isSqliteFile(file))) {
        setError(`${file.name} is not a BetterView backup (.db) file.`);
        return;
      }
      const confirmed = window.confirm(
        `Restore from ${file.name}?\n\nThis replaces ALL current data on this device, and the restored data will then sync to Google Drive. Download a backup first if you might want the current data back.`,
      );
      if (!confirmed) return;
      setBusy('restore');
      await loadDatabaseFile(file);
      triggerMutation();
      notifyDataChanged();
      setSuccess(`Restored from ${file.name}.`);
    } catch (err) {
      setError(errorMessage(err, 'Could not restore from that file.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      icon={DatabaseBackup}
      title="Backup"
      description="Download a copy of everything as a single file, or restore from one."
    >
      <ErrorNote message={error} />
      <SuccessNote message={success} />
      <div className="flex flex-col sm:flex-row gap-2">
        <button type="button" className={primaryButtonClass} onClick={handleDownload} disabled={busy !== null}>
          <Download className="h-4 w-4" aria-hidden="true" />
          {busy === 'download' ? 'Preparing…' : 'Download backup'}
        </button>
        <button type="button" className={secondaryButtonClass} onClick={() => fileInputRef.current?.click()} disabled={busy !== null}>
          <Upload className="h-4 w-4" aria-hidden="true" />
          {busy === 'restore' ? 'Restoring…' : 'Restore from file'}
        </button>
        <input ref={fileInputRef} type="file" accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3,application/x-sqlite3" className="hidden" onChange={handleRestore} />
      </div>
    </Section>
  );
}
