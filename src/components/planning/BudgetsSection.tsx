import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Plus, Target, Trash2, X } from 'lucide-react';
import { deleteBudget, getBudgetProgress, getCategoryNames, setBudget } from '../../db/features.js';
import { Empty, ErrorNote, Loading, Section } from './ui';
import {
  dangerIconButtonClass,
  errorMessage,
  iconButtonClass,
  inputClass,
  money,
  monthLabel,
  percent,
  primaryButtonClass,
  secondaryButtonClass,
  todayIso,
  useDbData,
  useMutation,
} from './shared';
import type { BudgetProgress, DbApi } from '../../types';

const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function BudgetBar({ row }: { row: BudgetProgress }) {
  const fill = Math.min(row.percent, 1) * 100;
  const pace = row.monthly_amount > 0 ? Math.min(row.expectedByToday / row.monthly_amount, 1) * 100 : 0;
  const color = row.isOver ? 'bg-red-500' : row.isAheadOfPace ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="relative h-2.5 rounded-full bg-gray-100 overflow-visible" aria-hidden="true">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${fill}%` }} />
      {pace > 0 && pace < 100 && (
        <div className="absolute -top-1 -bottom-1 w-0.5 bg-gray-700" style={{ left: `${pace}%` }} title="Where spending should be by today" />
      )}
    </div>
  );
}

export default function BudgetsSection() {
  const today = todayIso();
  const [month, setMonth] = useState(today.slice(0, 7));
  const loadProgress = useCallback(
    (db: DbApi) => getBudgetProgress(db, month, today),
    [month, today],
  );
  const { data: rows, isLoading, error: loadError } = useDbData(loadProgress, [] as BudgetProgress[]);
  const { data: categories } = useDbData(getCategoryNames, [] as string[]);
  const mutate = useMutation();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const openForm = (row?: BudgetProgress) => {
    setEditing(row?.category ?? null);
    setCategory(row?.category ?? '');
    setAmount(row ? String(row.monthly_amount) : '');
    setError('');
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditing(null);
    setError('');
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError('');
    try {
      await mutate((db) => setBudget(db, category, amount));
      closeForm();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the budget.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (row: BudgetProgress) => {
    if (!window.confirm(`Delete the ${row.category} budget?`)) return;
    try {
      await mutate((db) => deleteBudget(db, row.category));
    } catch (err) {
      setError(errorMessage(err, 'Could not delete the budget.'));
    }
  };

  const budgeted = new Set(rows.map((row) => row.category));
  const pickable = categories.filter((name) => name === editing || !budgeted.has(name));
  const totalBudget = rows.reduce((sum, row) => sum + row.monthly_amount, 0);
  const totalSpent = rows.reduce((sum, row) => sum + row.spent, 0);
  const isCurrentMonth = month === today.slice(0, 7);

  return (
    <Section
      icon={Target}
      title="Budgets"
      description="Monthly spending per category, net of reimbursements linked to those expenses."
      action={!isFormOpen && (
        <button type="button" className={primaryButtonClass} onClick={() => openForm()}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Add budget
        </button>
      )}
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button type="button" className={iconButtonClass} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <input
          type="month"
          aria-label="Budget month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          className={`${inputClass} max-w-[11rem]`}
        />
        <button type="button" className={iconButtonClass} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
          <ChevronRight className="h-5 w-5" />
        </button>
        {!isCurrentMonth && (
          <button type="button" className="text-sm text-primary-600 hover:underline ml-1" onClick={() => setMonth(today.slice(0, 7))}>
            This month
          </button>
        )}
      </div>

      <ErrorNote message={loadError || (!isFormOpen ? error : '')} />

      {isFormOpen && (
        <form onSubmit={handleSubmit} className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">{editing ? `Edit ${editing} budget` : 'New budget'}</h3>
            <button type="button" className={iconButtonClass} onClick={closeForm} aria-label="Cancel">
              <X className="h-4 w-4" />
            </button>
          </div>
          <ErrorNote message={error} />
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_12rem] gap-3">
            <label className="text-sm text-gray-700 space-y-1 min-w-0">
              <span className="block font-medium">Category</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={inputClass}
                disabled={Boolean(editing)}
                required
              >
                <option value="" disabled>Choose a category</option>
                {pickable.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="text-sm text-gray-700 space-y-1 min-w-0">
              <span className="block font-medium">Monthly amount</span>
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={inputClass}
                placeholder="500"
                required
              />
            </label>
          </div>
          {pickable.length === 0 && !editing && (
            <p className="text-xs text-gray-500">Every category already has a budget. Import or categorize transactions to add more categories.</p>
          )}
          <div className="flex gap-2 justify-end">
            <button type="button" className={secondaryButtonClass} onClick={closeForm}>Cancel</button>
            <button type="submit" className={primaryButtonClass} disabled={isSaving || !category}>
              {isSaving ? 'Saving…' : 'Save budget'}
            </button>
          </div>
        </form>
      )}

      {isLoading && rows.length === 0 ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>No budgets yet. Add one to track a category's spending each month.</Empty>
      ) : (
        <>
          <p className="text-sm text-gray-600 mb-3">
            {monthLabel(month, 'long')}: <span className="font-semibold text-gray-900 tabular-nums">{money(totalSpent)}</span> of{' '}
            <span className="tabular-nums">{money(totalBudget)}</span> budgeted
          </p>
          <ul className="divide-y divide-gray-100">
            {rows.map((row) => (
              <li key={row.category} className={`py-3 ${row.isOver ? 'bg-red-50/60 -mx-2 px-2 rounded-lg' : ''}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{row.category}</p>
                    <p className="text-sm text-gray-600 tabular-nums">
                      {money(row.spent)} of {money(row.monthly_amount)}
                      <span className="text-gray-400"> · {percent(row.percent)}</span>
                    </p>
                  </div>
                  <div className="flex items-center shrink-0">
                    <button type="button" className={iconButtonClass} onClick={() => openForm(row)} aria-label={`Edit ${row.category} budget`}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" className={dangerIconButtonClass} onClick={() => handleDelete(row)} aria-label={`Delete ${row.category} budget`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <BudgetBar row={row} />
                <p className={`text-xs mt-1.5 ${row.isOver ? 'text-red-700 font-medium' : row.isAheadOfPace ? 'text-amber-700' : 'text-gray-500'}`}>
                  {row.isOver
                    ? `Over budget by ${money(-row.remaining)}`
                    : row.isAheadOfPace
                      ? `${money(row.remaining)} left · ahead of pace (expected ${money(row.expectedByToday)} by today)`
                      : `${money(row.remaining)} left${isCurrentMonth ? ' · on pace' : ''}`}
                </p>
              </li>
            ))}
          </ul>
          {isCurrentMonth && (
            <p className="text-xs text-gray-500 mt-3 flex items-center gap-2">
              <span className="inline-block w-0.5 h-3 bg-gray-700" aria-hidden="true" /> marks where spending would be if spread evenly through the month.
            </p>
          )}
        </>
      )}
    </Section>
  );
}
