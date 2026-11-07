import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download } from 'lucide-react';
import type { NetWorthWithOutside } from '../../types';
import { downloadBytes } from '../../download';
import { netWorthAccountsToCsv, netWorthFileName, netWorthHistoryToCsv } from '../../netWorthCsv';
import { secondaryButtonClass } from '../planning/shared';

type Kind = 'history' | 'accounts';

const save = (history: NetWorthWithOutside[], kind: Kind) =>
  downloadBytes(
    kind === 'accounts' ? netWorthAccountsToCsv(history) : netWorthHistoryToCsv(history),
    netWorthFileName(kind),
    'text/csv;charset=utf-8',
  );

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

// Saves the history straight away when there are no account balances to offer;
// otherwise opens a menu of the totals or the per-account balances.
export default function NetWorthExportMenu({ history }: { history: NetWorthWithOutside[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const accountRows = history.reduce((n, p) => n + p.accounts.length + Object.keys(p.outsideByAccount).length, 0);
  const options: Array<{ kind: Kind; label: string; count: string }> = [
    { kind: 'history', label: 'Net worth by date', count: plural(history.length, 'date') },
  ];
  if (accountRows > 0) options.push({ kind: 'accounts', label: 'Account balances by date', count: plural(accountRows, 'row') });

  const hasMenu = options.length > 1;
  const choose = (kind: Kind) => {
    setOpen(false);
    save(history, kind);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={secondaryButtonClass}
        onClick={() => (hasMenu ? setOpen((v) => !v) : choose('history'))}
        aria-haspopup={hasMenu ? 'menu' : undefined}
        aria-expanded={hasMenu ? open : undefined}
        title={hasMenu ? 'Export to CSV' : `Export ${plural(history.length, 'date')} to CSV`}
      >
        <Download className="h-4 w-4" aria-hidden="true" /> Export CSV
        {hasMenu && <ChevronDown className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />}
      </button>

      {open && (
        <div role="menu" className="absolute left-0 sm:left-auto sm:right-0 z-20 mt-1 w-64 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {options.map(({ kind, label, count }) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              onClick={() => choose(kind)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              <span>{label}</span>
              <span className="text-xs text-gray-500">{count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
