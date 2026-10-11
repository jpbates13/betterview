import { useState } from 'react';
import { CopyX, Trash2 } from 'lucide-react';
import { getPossibleDuplicates } from '../../db/features.js';
import { deleteTransaction } from '../../dbQueries.js';
import { Empty, ErrorNote, Loading, Section } from '../planning/ui';
import { errorMessage, money, secondaryButtonClass, useDbData, useMutation } from '../planning/shared';
import type { Db } from '../planning/shared';

type Pair = {
  a_id: number; a_date: string; a_description: string; a_source: string | null;
  b_id: number; b_date: string; b_description: string; b_source: string | null;
  amount: number; account: string;
};

const DISMISSED_KEY = 'betterview.duplicates.dismissed.v1';
const pairKey = (pair: Pair) => `${pair.a_id}-${pair.b_id}`;

const readDismissed = (): string[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISMISSED_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

const loadPairs = (db: Db) => getPossibleDuplicates(db) as Promise<Pair[]>;

function Copy({ date, description, source }: { date: string; description: string; source: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-gray-900 break-words">{description}</p>
      <p className="text-xs text-gray-500 break-all">{date}{source ? ` · ${source}` : ''}</p>
    </div>
  );
}

export default function DuplicatesSection() {
  const { data: pairs, isLoading, error: loadError } = useDbData(loadPairs, [] as Pair[]);
  const mutate = useMutation();
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const dismiss = (pair: Pair) => {
    const next = [...new Set([...dismissed, pairKey(pair)])];
    setDismissed(next);
    try {
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Not remembered across visits without storage; fine.
    }
  };

  const removeCopy = async (pair: Pair, which: 'a' | 'b') => {
    const id = which === 'a' ? pair.a_id : pair.b_id;
    const description = which === 'a' ? pair.a_description : pair.b_description;
    const date = which === 'a' ? pair.a_date : pair.b_date;
    if (!window.confirm(`Delete this copy?\n\n${date} | ${description} | ${money(pair.amount)}\n\nThis cannot be undone.`)) return;
    setBusy(pairKey(pair));
    setError('');
    try {
      await mutate((db) => deleteTransaction(db, id));
    } catch (err) {
      setError(errorMessage(err, 'Could not delete that transaction.'));
    } finally {
      setBusy(null);
    }
  };

  const visible = pairs.filter((pair) => !dismissed.includes(pairKey(pair)));
  const hiddenCount = pairs.length - visible.length;

  return (
    <Section
      icon={CopyX}
      title="Possible duplicates"
      description="Same account and amount within a few days, from different files or identical rows. Delete the extra copy or keep both."
    >
      <ErrorNote message={loadError || error} />
      {isLoading && pairs.length === 0 ? (
        <Loading />
      ) : visible.length === 0 ? (
        <Empty>No possible duplicates to review.</Empty>
      ) : (
        <ul className="space-y-3">
          {visible.map((pair) => (
            <li key={pairKey(pair)} className="rounded-xl border border-gray-200 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-gray-900 tabular-nums">{money(pair.amount)}</p>
                <p className="text-xs text-gray-500 truncate">{pair.account}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(['a', 'b'] as const).map((which) => (
                  <div key={which} className="flex items-start justify-between gap-2 rounded-lg bg-gray-50 p-2">
                    <Copy
                      date={which === 'a' ? pair.a_date : pair.b_date}
                      description={which === 'a' ? pair.a_description : pair.b_description}
                      source={which === 'a' ? pair.a_source : pair.b_source}
                    />
                    <button
                      type="button"
                      onClick={() => removeCopy(pair, which)}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1 shrink-0 text-xs font-medium text-red-700 hover:bg-red-50 rounded-md px-2 py-1.5 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex justify-end mt-2">
                <button type="button" className={secondaryButtonClass} onClick={() => dismiss(pair)} disabled={busy !== null}>
                  Not a duplicate
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {hiddenCount > 0 && (
        <button
          type="button"
          className="text-sm text-primary-600 hover:underline mt-3"
          onClick={() => {
            setDismissed([]);
            try { window.localStorage.removeItem(DISMISSED_KEY); } catch { /* ignore */ }
          }}
        >
          Show {hiddenCount} pair{hiddenCount === 1 ? '' : 's'} marked as not duplicates
        </button>
      )}
    </Section>
  );
}
