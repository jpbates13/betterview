import { useCallback, useState } from 'react';
import { ArrowUpRight, Repeat } from 'lucide-react';
import { detectRecurringCharges } from '../../db/features.js';
import { Empty, ErrorNote, Kpi, Loading, Section } from './ui';
import { money, todayIso, useDbData } from './shared';
import type { DbApi, RecurringCharge } from '../../types';

const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function RecurringSection() {
  const today = todayIso();
  const load = useCallback((db: DbApi) => detectRecurringCharges(db, { today }), [today]);
  const { data: charges, isLoading, error } = useDbData(load, [] as RecurringCharge[]);
  const [showStopped, setShowStopped] = useState(false);

  const active = charges.filter((c) => !c.isStopped);
  const stopped = charges.filter((c) => c.isStopped);
  const yearlyTotal = active.reduce((sum, c) => sum + c.yearlyCost, 0);
  const increases = active.filter((c) => c.priceChange > 0).length;
  const visible = showStopped ? charges : active;

  return (
    <Section
      icon={Repeat}
      title="Recurring & subscriptions"
      description="Charges that repeat on a steady schedule from the same merchant."
    >
      <ErrorNote message={error} />
      {isLoading && charges.length === 0 ? (
        <Loading />
      ) : charges.length === 0 ? (
        <Empty>No recurring charges found yet. They appear once a merchant has charged you at least three times on a regular schedule.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <Kpi label="Yearly cost" value={money(yearlyTotal)} hint={`${active.length} active`} />
            <Kpi label="Per month" value={money(yearlyTotal / 12)} />
            <Kpi label="Price increases" value={String(increases)} tone={increases > 0 ? 'bad' : 'neutral'} hint={stopped.length ? `${stopped.length} stopped` : undefined} />
          </div>
          {stopped.length > 0 && (
            <label className="inline-flex items-center gap-2 text-sm text-gray-600 mb-3 select-none">
              <input type="checkbox" checked={showStopped} onChange={(e) => setShowStopped(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
              Show charges that stopped ({stopped.length})
            </label>
          )}
          <ul className="divide-y divide-gray-100">
            {visible.map((c) => (
              <li key={`${c.merchant}-${c.firstDate}-${c.typicalAmount}`} className={`py-3 flex items-start justify-between gap-3 ${c.isStopped ? 'opacity-60' : ''}`}>
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{c.merchant}</p>
                  <p className="text-sm text-gray-500">
                    <span className="capitalize">{c.cadence}</span>
                    {c.category ? ` · ${c.category}` : ''}
                    {' · '}
                    {c.isStopped ? `last ${formatDate(c.lastDate)}` : `next ~${formatDate(c.nextExpected)}`}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {c.priceChange > 0 && !c.isStopped && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 rounded px-1.5 py-0.5">
                        <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                        Up {money(c.priceChange)} to {money(c.lastAmount)}
                      </span>
                    )}
                    {c.priceChange < 0 && !c.isStopped && (
                      <span className="text-xs font-medium text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5">
                        Down {money(-c.priceChange)}
                      </span>
                    )}
                    {c.isStopped && (
                      <span className="text-xs font-medium text-gray-700 bg-gray-100 rounded px-1.5 py-0.5">Stopped</span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold text-gray-900 tabular-nums" title="Typical amount">{money(c.typicalAmount)}</p>
                  <p className="text-xs text-gray-500 tabular-nums">{money(c.yearlyCost)}/yr</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}
