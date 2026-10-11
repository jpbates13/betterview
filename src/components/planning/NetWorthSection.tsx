import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { Landmark, Pencil, Plus, Trash2, X } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { deleteAccountBalance, getAccountBalances, getNetWorthSeries, setAccountBalance } from '../../db/features.js';
import { Empty, ErrorNote, Kpi, Loading, Section } from './ui';
import {
  dangerIconButtonClass,
  errorMessage,
  iconButtonClass,
  inputClass,
  money,
  moneyWhole,
  monthLabel,
  primaryButtonClass,
  secondaryButtonClass,
  todayIso,
  useDbData,
  useMutation,
} from './shared';
import type { AccountBalance, DbApi, NetWorthPoint } from '../../types';

type Data = { snapshots: AccountBalance[]; series: NetWorthPoint[]; accounts: string[] };

const NET_WORTH_COLOR = '#2563EB';

export default function NetWorthSection() {
  const today = todayIso();
  const load = useCallback(async (db: DbApi): Promise<Data> => {
    const [snapshots, series, accountRows] = await Promise.all([
      getAccountBalances(db),
      getNetWorthSeries(db, { months: 24, today }),
      db.exec("SELECT DISTINCT account FROM transactions WHERE account IS NOT NULL AND TRIM(account) <> '' ORDER BY account;"),
    ]);
    const fromTransactions = (accountRows[0]?.values ?? []).map((row) => String(row[0]));
    const typed = snapshots.map((s) => ({ ...s, id: Number(s.id), balance: Number(s.balance) }));
    const accounts = [...new Set([...typed.map((s) => s.account), ...fromTransactions])].sort((a, b) => a.localeCompare(b));
    return { snapshots: typed, series, accounts };
  }, [today]);
  const { data, isLoading, error: loadError } = useDbData(load, { snapshots: [], series: [], accounts: [] } as Data);
  const mutate = useMutation();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<AccountBalance | null>(null);
  const [account, setAccount] = useState('');
  const [date, setDate] = useState(today);
  const [balance, setBalance] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const openForm = (snapshot?: AccountBalance) => {
    setEditing(snapshot ?? null);
    setAccount(snapshot?.account ?? '');
    setDate(snapshot?.date ?? today);
    setBalance(snapshot ? String(snapshot.balance) : '');
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
      await mutate(async (db) => {
        await setAccountBalance(db, { account, date, balance });
        // Changing the account or date of an existing snapshot moves it.
        if (editing && (editing.account !== account.trim() || editing.date !== date)) {
          await deleteAccountBalance(db, editing.id);
        }
      });
      closeForm();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the balance.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (snapshot: AccountBalance) => {
    if (!window.confirm(`Delete the ${snapshot.account} balance from ${snapshot.date}?`)) return;
    try {
      await mutate((db) => deleteAccountBalance(db, snapshot.id));
    } catch (err) {
      setError(errorMessage(err, 'Could not delete the balance.'));
    }
  };

  const latest = data.series[data.series.length - 1];
  const yearAgo = data.series.length > 12 ? data.series[data.series.length - 13] : data.series[0];
  const change = latest && yearAgo && latest !== yearAgo ? latest.netWorth - yearAgo.netWorth : null;
  const chartData = data.series.map((p) => ({ ...p, label: monthLabel(p.date.slice(0, 7)) }));
  const visibleSnapshots = showAll ? data.snapshots : data.snapshots.slice(0, 8);

  return (
    <Section
      icon={Landmark}
      title="Net worth"
      description="Enter account balances now and then; months in between are carried forward with that account's transactions. Enter debts as negative balances."
      action={!isFormOpen && (
        <button type="button" className={primaryButtonClass} onClick={() => openForm()}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Add balance
        </button>
      )}
    >
      <ErrorNote message={loadError || (!isFormOpen ? error : '')} />

      {isFormOpen && (
        <form onSubmit={handleSubmit} className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">{editing ? 'Edit balance' : 'New balance'}</h3>
            <button type="button" className={iconButtonClass} onClick={closeForm} aria-label="Cancel">
              <X className="h-4 w-4" />
            </button>
          </div>
          <ErrorNote message={error} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-sm text-gray-700 space-y-1 min-w-0">
              <span className="block font-medium">Account</span>
              <input
                list="networth-accounts"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className={inputClass}
                placeholder="Checking"
                required
              />
              <datalist id="networth-accounts">
                {data.accounts.map((name) => <option key={name} value={name} />)}
              </datalist>
            </label>
            <label className="text-sm text-gray-700 space-y-1 min-w-0">
              <span className="block font-medium">Date</span>
              <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={inputClass} required />
            </label>
            <label className="text-sm text-gray-700 space-y-1 min-w-0">
              <span className="block font-medium">Balance</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                className={inputClass}
                placeholder="-1200 for a card balance"
                required
              />
            </label>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" className={secondaryButtonClass} onClick={closeForm}>Cancel</button>
            <button type="submit" className={primaryButtonClass} disabled={isSaving}>{isSaving ? 'Saving…' : 'Save balance'}</button>
          </div>
        </form>
      )}

      {isLoading && data.snapshots.length === 0 ? (
        <Loading />
      ) : data.snapshots.length === 0 ? (
        <Empty>No balances yet. Add each account's balance on a recent date to start tracking net worth.</Empty>
      ) : (
        <>
          {latest && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              <Kpi label="Net worth" value={moneyWhole(latest.netWorth)} hint={`as of ${latest.date}`} />
              <Kpi
                label={data.series.length > 12 ? 'Change over 12 months' : 'Change since start'}
                value={change === null ? '—' : `${change >= 0 ? '+' : '−'}${moneyWhole(Math.abs(change))}`}
                tone={change === null ? 'neutral' : change >= 0 ? 'good' : 'bad'}
              />
            </div>
          )}
          {chartData.length > 1 && (
            <div className="h-56 sm:h-64 -ml-2 mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8} />
                  <YAxis tickFormatter={(v) => moneyWhole(v)} tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} width={72} />
                  <Tooltip formatter={(value) => [money(Number(value)), 'Net worth']} labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ''} />
                  <Line type="monotone" dataKey="netWorth" name="Net worth" stroke={NET_WORTH_COLOR} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <h3 className="text-sm font-semibold text-gray-700 mb-1">Balance snapshots</h3>
          <ul className="divide-y divide-gray-100">
            {visibleSnapshots.map((s) => (
              <li key={s.id} className="py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{s.account}</p>
                  <p className="text-xs text-gray-500">{s.date}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className={`tabular-nums text-sm font-medium mr-1 ${s.balance < 0 ? 'text-red-700' : 'text-gray-900'}`}>{money(s.balance)}</span>
                  <button type="button" className={iconButtonClass} onClick={() => openForm(s)} aria-label={`Edit ${s.account} balance from ${s.date}`}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button type="button" className={dangerIconButtonClass} onClick={() => handleDelete(s)} aria-label={`Delete ${s.account} balance from ${s.date}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {data.snapshots.length > 8 && (
            <button type="button" className="text-sm text-primary-600 hover:underline mt-2" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer' : `Show all ${data.snapshots.length}`}
            </button>
          )}
        </>
      )}
    </Section>
  );
}
