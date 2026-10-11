import { useState } from 'react';
import { History, Undo2 } from 'lucide-react';
import { getImportBatches, undoImportBatch } from '../../csvImporter.js';
import { Empty, ErrorNote, Loading, Section, SuccessNote } from '../planning/ui';
import { errorMessage, secondaryButtonClass, useDbData, useMutation } from '../planning/shared';
import type { Db } from '../planning/shared';

type Batch = {
  id: number | string;
  file_name: string;
  profile_name: string | null;
  imported_at: string;
  inserted_count: number;
  duplicate_count: number;
  visible_rows: number;
};

const loadBatches = (db: Db) => getImportBatches(db) as Promise<Batch[]>;

const formatWhen = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

export default function ImportHistorySection() {
  const { data: batches, isLoading, error: loadError } = useDbData(loadBatches, [] as Batch[]);
  const mutate = useMutation();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [undoing, setUndoing] = useState<Batch['id'] | null>(null);

  const handleUndo = async (batch: Batch) => {
    const confirmed = window.confirm(
      `Undo the import of ${batch.file_name}?\n\nThis deletes the ${batch.inserted_count} transactions it added, including any edits, tags or splits made to them since.`,
    );
    if (!confirmed) return;
    setUndoing(batch.id);
    setError('');
    setSuccess('');
    try {
      const removed = await mutate((db) => undoImportBatch(db, batch.id));
      setSuccess(`Removed ${removed} transactions from ${batch.file_name}.`);
    } catch (err) {
      setError(errorMessage(err, 'Could not undo that import.'));
    } finally {
      setUndoing(null);
    }
  };

  return (
    <Section icon={History} title="Import history" description="Each CSV import, newest first. Undo removes everything that import added.">
      <ErrorNote message={loadError || error} />
      <SuccessNote message={success} />
      {isLoading && batches.length === 0 ? (
        <Loading />
      ) : batches.length === 0 ? (
        <Empty>No imports recorded yet.</Empty>
      ) : (
        <ul className="divide-y divide-gray-100">
          {batches.map((batch) => (
            <li key={batch.id} className="py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate" title={batch.file_name}>{batch.file_name}</p>
                <p className="text-sm text-gray-500">
                  {formatWhen(batch.imported_at)}
                  {batch.profile_name ? ` · ${batch.profile_name}` : ''}
                </p>
                <p className="text-sm text-gray-600 tabular-nums">
                  {Number(batch.inserted_count)} added · {Number(batch.duplicate_count)} skipped as duplicates
                  {Number(batch.visible_rows) !== Number(batch.inserted_count) ? ` · ${Number(batch.visible_rows)} still visible` : ''}
                </p>
              </div>
              <button
                type="button"
                className={`${secondaryButtonClass} shrink-0`}
                onClick={() => handleUndo(batch)}
                disabled={undoing !== null}
              >
                <Undo2 className="h-4 w-4" aria-hidden="true" />
                {undoing === batch.id ? 'Undoing…' : 'Undo'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
