import { useEffect, useState } from 'react';
import { Link2, Unlink, HandCoins } from 'lucide-react';
import { useDatabase } from '../../DatabaseContext.jsx';
import { getLinkedReimbursements, getReimbursementStatus, linkReimbursement } from '../../db/features.js';
import { getTransactions, getUnlinkedCredits } from './api';
import { errorMessage, type DatabaseContextValue, type Transaction } from './types';

interface CreditRow {
  id: number;
  date: string;
  description: string;
  amount: number;
}

interface ReimbursementSectionProps {
  transaction: Transaction;
}

const money = (n: number) => `$${Math.abs(n).toFixed(2)}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

const toCredit = (row: Record<string, unknown>): CreditRow => ({
  id: Number(row.id),
  date: String(row.date ?? ''),
  description: String(row.description ?? ''),
  amount: Number(row.amount ?? 0),
});

/**
 * Reimbursement links for one transaction: for an expense, the credits that pay
 * it back and what's still owed; for a credit, the expense it pays back.
 */
export default function ReimbursementSection({ transaction }: ReimbursementSectionProps) {
  const { db, notifyDataChanged, triggerMutation } = useDatabase() as DatabaseContextValue;
  const isExpense = transaction.amount < 0;

  const [linked, setLinked] = useState<CreditRow[]>([]);
  const [candidates, setCandidates] = useState<CreditRow[]>([]);
  const [trackedOutstanding, setTrackedOutstanding] = useState<number | null>(null);
  const [linkedExpense, setLinkedExpense] = useState<Transaction | null>(null);
  const [reimbursesId, setReimbursesId] = useState<number | null>(transaction.reimburses_id ?? null);
  const [chosenCredit, setChosenCredit] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    (async () => {
      try {
        if (isExpense) {
          const [linkedRows, candidateRows, statusRows] = await Promise.all([
            getLinkedReimbursements(db, transaction.id),
            getUnlinkedCredits(db, { aroundDate: transaction.date }),
            getReimbursementStatus(db),
          ]);
          if (cancelled) return;
          setLinked((linkedRows as Record<string, unknown>[]).map(toCredit));
          setCandidates((candidateRows as Record<string, unknown>[]).map(toCredit));
          const status = (statusRows as Array<{ id: number; outstanding: number }>).find((row) => Number(row.id) === transaction.id);
          setTrackedOutstanding(status ? Number(status.outstanding) : null);
        } else if (reimbursesId) {
          const rows = await getTransactions(db, { ids: [reimbursesId] });
          if (cancelled) return;
          setLinkedExpense(rows[0] ?? null);
        } else {
          setLinkedExpense(null);
        }
        if (!cancelled) setIsLoaded(true);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Could not load reimbursements.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, isExpense, transaction.id, transaction.date, reimbursesId, reloadKey]);

  const runLink = async (creditId: number, expenseId: number | null) => {
    if (!db) return;
    setBusy(true);
    setError(null);
    try {
      await linkReimbursement(db, creditId, expenseId);
      notifyDataChanged();
      triggerMutation();
      if (!isExpense) setReimbursesId(expenseId);
      setChosenCredit('');
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(errorMessage(err, 'Could not update the link.'));
    } finally {
      setBusy(false);
    }
  };

  if (!isExpense && transaction.amount > 0 && !reimbursesId) {
    return null;
  }
  if (transaction.amount === 0) return null;

  const repaid = round2(linked.reduce((sum, row) => sum + row.amount, 0));
  const outstanding = trackedOutstanding ?? Math.max(round2(Math.abs(transaction.amount) - repaid), 0);

  return (
    <section className="rounded-lg border border-gray-200 p-3 space-y-2" aria-label="Reimbursements">
      <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
        <HandCoins className="h-4 w-4 text-gray-500" />
        {isExpense ? 'Reimbursements' : 'Reimburses'}
      </h3>
      {error && <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1" role="alert">{error}</p>}
      {!isLoaded && !error && <p className="text-xs text-gray-500">Loading…</p>}

      {isLoaded && !isExpense && (
        linkedExpense ? (
          <div className="flex items-start justify-between gap-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-gray-900 truncate">{linkedExpense.description}</p>
              <p className="text-xs text-gray-500">{linkedExpense.date} · {money(linkedExpense.amount)} expense · {linkedExpense.category}</p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => runLink(transaction.id, null)}
              className="inline-flex items-center gap-1 text-xs text-gray-600 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 shrink-0"
            >
              <Unlink className="h-3 w-3" /> Unlink
            </button>
          </div>
        ) : (
          <p className="text-xs text-gray-500">Linked to a transaction that no longer exists.</p>
        )
      )}

      {isLoaded && isExpense && (
        <>
          <p className="text-sm text-gray-700">
            {linked.length === 0 ? 'Nothing linked yet.' : `${money(repaid)} paid back.`}{' '}
            {(linked.length > 0 || trackedOutstanding !== null) && (
              outstanding > 0.005
                ? <span className="font-medium text-amber-700">{money(outstanding)} outstanding.</span>
                : <span className="font-medium text-emerald-700">Fully reimbursed.</span>
            )}
          </p>
          {linked.length > 0 && (
            <ul className="divide-y divide-gray-100 border border-gray-100 rounded-md">
              {linked.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-gray-900">{row.description}</p>
                    <p className="text-xs text-gray-500">{row.date} · <span className="text-emerald-700">+{money(row.amount)}</span></p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runLink(row.id, null)}
                    className="inline-flex items-center gap-1 text-xs text-gray-600 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 shrink-0"
                  >
                    <Unlink className="h-3 w-3" /> Unlink
                  </button>
                </li>
              ))}
            </ul>
          )}
          {candidates.length > 0 ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                aria-label="Credit to link"
                className="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
                value={chosenCredit}
                onChange={(e) => setChosenCredit(e.target.value)}
              >
                <option value="">Link a refund or repayment…</option>
                {candidates.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.date} · +{money(row.amount)} · {row.description}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !chosenCredit}
                onClick={() => runLink(Number(chosenCredit), transaction.id)}
                className="inline-flex items-center justify-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-60"
              >
                <Link2 className="h-3.5 w-3.5" /> Link
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-500">No unlinked credits within 60 days of this expense.</p>
          )}
        </>
      )}
    </section>
  );
}
