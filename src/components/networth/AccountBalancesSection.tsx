import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Landmark, ListPlus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { deleteAccountBalance, getAccountBalances, setAccountBalance } from '../../db/features.js';
import { getOutsideAccounts, importAccountBalances, setAccountAddsToNetWorth } from '../../db/netWorth.js';
import { parseNetWorthHistory } from '../../db/netWorthParser.js';
import { Empty, ErrorNote, Loading, Section, SuccessNote } from '../planning/ui';
import {
  dangerIconButtonClass,
  errorMessage,
  iconButtonClass,
  inputClass,
  money,
  primaryButtonClass,
  secondaryButtonClass,
  todayIso,
  useDbData,
  useMutation,
} from '../planning/shared';
import type { AccountBalance, DbApi, OutsideAccount } from '../../types';

type Data = { snapshots: AccountBalance[]; outside: OutsideAccount[]; accounts: string[] };
type Panel = 'balance' | 'history' | null;

const dateLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function AccountBalancesSection() {
  const today = todayIso();
  const load = useCallback(async (db: DbApi): Promise<Data> => {
    const [snapshots, outside, accountRows] = await Promise.all([
      getAccountBalances(db),
      getOutsideAccounts(db),
      db.exec("SELECT DISTINCT account FROM transactions WHERE account IS NOT NULL AND TRIM(account) <> '' ORDER BY account;"),
    ]);
    const fromTransactions = (accountRows[0]?.values ?? []).map((row) => String(row[0]));
    const typed = snapshots.map((s) => ({ ...s, id: Number(s.id), balance: Number(s.balance) }));
    const accounts = [...new Set([...typed.map((s) => s.account), ...fromTransactions])].sort((a, b) => a.localeCompare(b));
    return { snapshots: typed, outside, accounts };
  }, []);
  const { data, isLoading, error: loadError } = useDbData(load, { snapshots: [], outside: [], accounts: [] } as Data);
  const mutate = useMutation();

  const [panel, setPanel] = useState<Panel>(null);
  const [editing, setEditing] = useState<AccountBalance | null>(null);
  const [account, setAccount] = useState('');
  const [date, setDate] = useState(today);
  const [balance, setBalance] = useState('');
  const [historyText, setHistoryText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const parsedHistory = useMemo(() => parseNetWorthHistory(historyText), [historyText]);

  const openPanel = (next: Panel, snapshot?: AccountBalance, forAccount?: string) => {
    setPanel(next);
    setEditing(snapshot ?? null);
    setAccount(snapshot?.account ?? forAccount ?? '');
    setDate(snapshot?.date ?? today);
    setBalance(snapshot ? String(snapshot.balance) : '');
    setHistoryText('');
    setError('');
    setNotice('');
  };

  const closePanel = () => {
    setPanel(null);
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
      closePanel();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the balance.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleImport = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError('');
    try {
      const saved = await mutate((db) => importAccountBalances(db, account, parsedHistory.points));
      closePanel();
      setNotice(`Saved ${saved} balance${saved === 1 ? '' : 's'} for ${account.trim()}.`);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the balances.'));
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

  const toggleInclude = async (item: OutsideAccount) => {
    try {
      await mutate((db) => setAccountAddsToNetWorth(db, item.account, !item.include));
    } catch (err) {
      setError(errorMessage(err, 'Could not change the account.'));
    }
  };

  const visibleSnapshots = showAll ? data.snapshots : data.snapshots.slice(0, 8);
  const accountInput = (
    <label className="text-sm text-gray-700 space-y-1 min-w-0">
      <span className="block font-medium">Account</span>
      <input
        list="networth-accounts"
        value={account}
        onChange={(e) => setAccount(e.target.value)}
        className={inputClass}
        placeholder="HSA"
        required
      />
      <datalist id="networth-accounts">
        {data.accounts.map((name) => <option key={name} value={name} />)}
      </datalist>
    </label>
  );
  const panelHeader = (title: string) => (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <button type="button" className={iconButtonClass} onClick={closePanel} aria-label="Cancel">
        <X className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <Section
      icon={Landmark}
      title="Accounts outside Fidelity"
      description="For accounts Fidelity Full View doesn't include. Their balances are added to every net worth figure above, drawn as a straight line between the dates you enter and held at the latest one after that. Enter debts as negative balances."
      action={!panel && (
        <>
          <button type="button" className={primaryButtonClass} onClick={() => openPanel('history')}>
            <ListPlus className="h-4 w-4" aria-hidden="true" /> Paste history
          </button>
          <button type="button" className={secondaryButtonClass} onClick={() => openPanel('balance')}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add balance
          </button>
        </>
      )}
    >
      <ErrorNote message={loadError || (!panel ? error : '')} />
      {!panel && <SuccessNote message={notice} />}

      {panel === 'balance' && (
        <form onSubmit={handleSubmit} className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4 space-y-3">
          {panelHeader(editing ? 'Edit balance' : 'New balance')}
          <ErrorNote message={error} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {accountInput}
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
            <button type="button" className={secondaryButtonClass} onClick={closePanel}>Cancel</button>
            <button type="submit" className={primaryButtonClass} disabled={isSaving}>{isSaving ? 'Saving…' : 'Save balance'}</button>
          </div>
        </form>
      )}

      {panel === 'history' && (
        <form onSubmit={handleImport} className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4 space-y-3">
          {panelHeader('Paste an account history')}
          <p className="text-xs text-gray-500">
            One date and balance per line, such as <code>12/31/2024 $13,717.09</code>, or a whole statement with a column per year
            and an "Ending Balance" row. Balances already saved on the same dates are replaced.
          </p>
          <ErrorNote message={error} />
          <div className="max-w-sm">{accountInput}</div>
          <textarea
            className={`${inputClass} font-mono text-xs h-40 resize-y`}
            value={historyText}
            onChange={(e) => setHistoryText(e.target.value)}
            placeholder={'12/31/2024 $13,717.09\n12/31/2025 $21,346.41'}
            aria-label="Account balance history"
          />
          {historyText.trim() && (
            parsedHistory.points.length > 0 ? (
              <ul className="text-sm text-gray-700 grid grid-cols-1 sm:grid-cols-2 gap-x-6 max-h-48 overflow-y-auto">
                {parsedHistory.points.map((p) => (
                  <li key={p.date} className="flex justify-between gap-3 py-0.5">
                    <span>{dateLabel(p.date)}</span>
                    <span className="tabular-nums">{money(p.netWorth)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-amber-800">No dates with balances found yet.</p>
            )
          )}
          <div className="flex gap-2 justify-end">
            <button type="button" className={secondaryButtonClass} onClick={closePanel}>Cancel</button>
            <button type="submit" className={primaryButtonClass} disabled={isSaving || parsedHistory.points.length === 0}>
              {isSaving ? 'Saving…' : `Save ${parsedHistory.points.length || ''} balance${parsedHistory.points.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </form>
      )}

      {isLoading && data.snapshots.length === 0 ? (
        <Loading />
      ) : data.snapshots.length === 0 ? (
        <Empty>No accounts yet. Paste an account's balance history, or add its balance on a recent date.</Empty>
      ) : (
        <>
          <ul className="divide-y divide-gray-100 mb-4">
            {data.outside.map((item) => {
              const last = item.balances[item.balances.length - 1];
              return (
                <li key={item.account} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{item.account}</p>
                    <p className="text-xs text-gray-500">
                      {money(last.balance)} on {dateLabel(last.date)} · {item.balances.length} balance{item.balances.length === 1 ? '' : 's'} since {dateLabel(item.balances[0].date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={item.include} onChange={() => toggleInclude(item)} className="h-4 w-4" />
                      Add to net worth
                    </label>
                    <button type="button" className={iconButtonClass} onClick={() => openPanel('history', undefined, item.account)} aria-label={`Paste history for ${item.account}`}>
                      <ListPlus className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <h3 className="text-sm font-semibold text-gray-700 mb-1">Balances</h3>
          <ul className="divide-y divide-gray-100">
            {visibleSnapshots.map((s) => (
              <li key={s.id} className="py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{s.account}</p>
                  <p className="text-xs text-gray-500">{dateLabel(s.date)}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className={`tabular-nums text-sm font-medium mr-1 ${s.balance < 0 ? 'text-red-700' : 'text-gray-900'}`}>{money(s.balance)}</span>
                  <button type="button" className={iconButtonClass} onClick={() => openPanel('balance', s)} aria-label={`Edit ${s.account} balance from ${s.date}`}>
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
