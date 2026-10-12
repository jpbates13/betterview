import { money } from '../planning/shared';
import type { NetWorthAccount, NetWorthCategory } from '../../types';

const accountKey = (a: NetWorthAccount) => `${a.name}|${a.mask}|${a.institution}`;

const GROUPS = [
  { group: 'asset', label: 'Assets' },
  { group: 'liability', label: 'Liabilities' },
] as const;

/** Fidelity's accounts grouped the way the Net worth page groups them. */
export default function AccountBreakdown({
  categories,
  accounts,
  previous,
  assets,
  liabilities,
}: {
  categories: NetWorthCategory[];
  accounts: NetWorthAccount[];
  previous?: NetWorthAccount[];
  assets?: number | null;
  liabilities?: number | null;
}) {
  const previousByKey = new Map((previous ?? []).map((a) => [accountKey(a), a]));
  const groupTotals = { asset: assets, liability: liabilities };

  return (
    <div className="space-y-4">
      {GROUPS.map(({ group, label }) => {
        const inGroup = accounts.filter((a) => a.group === group);
        if (inGroup.length === 0) return null;
        // Categories in page order, plus any account category the totals didn't list.
        const names = [...new Set([
          ...categories.filter((c) => c.group === group).map((c) => c.name),
          ...inGroup.map((a) => a.category),
        ])];
        const groupTotal = groupTotals[group];
        return (
          <div key={group} className="min-w-0">
            <div className="flex items-baseline justify-between border-b border-gray-200 pb-1 mb-1">
              <h4 className="text-sm font-semibold text-gray-900">{label}</h4>
              {groupTotal !== undefined && groupTotal !== null && (
                <span className="tabular-nums text-sm font-semibold text-gray-900">{money(groupTotal)}</span>
              )}
            </div>
            {names.map((name) => {
              const rows = inGroup.filter((a) => a.category === name);
              if (rows.length === 0) return null;
              const total = categories.find((c) => c.group === group && c.name === name)?.total
                ?? rows.reduce((sum, a) => sum + (a.balance ?? 0), 0);
              return (
                <div key={name} className="mt-2">
                  <div className="flex items-baseline justify-between text-xs font-medium uppercase tracking-wide text-gray-500">
                    <span>{name}</span>
                    <span className="tabular-nums">{money(total)}</span>
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {rows.map((a) => {
                      const before = previousByKey.get(accountKey(a));
                      const change = previous && a.balance !== null && before?.balance !== null && before?.balance !== undefined
                        ? a.balance - before.balance
                        : null;
                      const detail = [a.type, a.mask && `••${a.mask}`, a.institution].filter(Boolean).join(' · ');
                      return (
                        <li key={accountKey(a)} className="py-1.5 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm text-gray-900 truncate">{a.name}</p>
                            <p className="text-xs text-gray-500 truncate">{detail}{a.updated ? ` · ${a.updated}` : ''}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`tabular-nums text-sm ${a.balance !== null && a.balance < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                              {a.balance === null ? 'Not available' : money(a.balance)}
                            </p>
                            {change !== null && Math.abs(change) >= 0.005 && (
                              <p className={`tabular-nums text-xs ${change >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                                {change >= 0 ? '+' : '−'}{money(Math.abs(change))}
                              </p>
                            )}
                            {previous && !before && <p className="text-xs text-gray-500">New</p>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
