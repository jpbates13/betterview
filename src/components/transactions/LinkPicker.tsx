import { useEffect, useState } from 'react';
import { Link2, Search } from 'lucide-react';
import { useDatabase } from '../../useDatabase';
import { searchLinkCandidates, type LinkCandidate } from '../../db/features.js';
import { errorMessage } from '../planning/shared';

interface LinkPickerProps {
  side: 'expense' | 'credit';
  nearDate: string;
  excludeId: number;
  busy: boolean;
  onPick: (id: number) => void;
}

const money = (n: number) => `$${Math.abs(n).toFixed(2)}`;

// Search box for picking the other side of a reimbursement link by hand, from any date.
export default function LinkPicker({ side, nearDate, excludeId, busy, onPick }: LinkPickerProps) {
  const { db } = useDatabase();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LinkCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    const timerId = window.setTimeout(async () => {
      try {
        const rows = await searchLinkCandidates(db, { side, query, nearDate, excludeId });
        if (!cancelled) {
          setResults(rows);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Search failed.'));
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [db, side, query, nearDate, excludeId]);

  return (
    <div className="space-y-1.5">
      <label className="relative block">
        <Search className="h-3.5 w-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={side === 'expense' ? 'Search expenses by name, category or amount' : 'Search credits by name or amount'}
          aria-label={side === 'expense' ? 'Search expenses' : 'Search credits'}
          className="w-full pl-7 pr-2 py-1.5 border border-gray-200 rounded-lg text-sm"
        />
      </label>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {results?.length === 0 && (
        <p className="text-xs text-gray-500">{side === 'expense' ? 'No matching expenses.' : 'No matching unlinked credits.'}</p>
      )}
      {results && results.length > 0 && (
        <ul className="max-h-56 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-md">
          {results.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
              <div className="min-w-0">
                <p className="truncate text-gray-900">{row.description}</p>
                <p className="text-xs text-gray-500">
                  {row.date} · {side === 'expense' ? money(row.amount) : <span className="text-emerald-700">+{money(row.amount)}</span>}
                  {row.category ? ` · ${row.category}` : ''}
                  {side === 'expense' && row.repaid > 0 ? ` · ${money(row.repaid)} already paid back` : ''}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(row.id)}
                className="inline-flex items-center gap-1 text-xs text-primary-700 border border-primary-100 bg-primary-50 rounded px-2 py-1 hover:bg-primary-100 shrink-0 disabled:opacity-60"
              >
                <Link2 className="h-3 w-3" /> Link
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
