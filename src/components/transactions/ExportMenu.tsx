import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download } from 'lucide-react';
import type { Transaction } from '../../types';
import { downloadBytes } from '../../download';
import { exportFileName, transactionsToCsv } from '../../transactionsCsv';

interface ExportMenuProps {
  /** Every row the table was given, in the table's current sort order. */
  all: Transaction[];
  /** The rows the current filters show, in the table's current sort order. */
  filtered: Transaction[];
  selected: Transaction[];
  hasActiveFilters: boolean;
}

type Scope = 'all' | 'filtered' | 'selected';

const save = (rows: Transaction[], scope: Scope) =>
  downloadBytes(transactionsToCsv(rows), exportFileName(scope), 'text/csv;charset=utf-8');

const plural = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'row' : 'rows'}`;

// With no filters or selection there is only one thing to export, so the button
// saves it straight away; otherwise it opens a menu of what to export.
export default function ExportMenu({ all, filtered, selected, hasActiveFilters }: ExportMenuProps) {
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

  const options: Array<{ scope: Scope; label: string; rows: Transaction[] }> = [];
  if (hasActiveFilters) options.push({ scope: 'filtered', label: 'Filtered view', rows: filtered });
  if (selected.length > 0) options.push({ scope: 'selected', label: 'Selected rows', rows: selected });
  options.push({ scope: 'all', label: 'All transactions', rows: all });

  const hasMenu = options.length > 1;
  const choose = (scope: Scope, rows: Transaction[]) => {
    setOpen(false);
    save(rows, scope);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => (hasMenu ? setOpen((v) => !v) : choose('all', all))}
        aria-haspopup={hasMenu ? 'menu' : undefined}
        aria-expanded={hasMenu ? open : undefined}
        title={hasMenu ? 'Export to CSV' : `Export all ${plural(all.length)} to CSV`}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm transition-colors"
      >
        <Download className="h-4 w-4" />
        Export CSV
        {hasMenu && <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-60 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {options.map(({ scope, label, rows }) => (
            <button
              key={scope}
              type="button"
              role="menuitem"
              disabled={rows.length === 0}
              onClick={() => choose(scope, rows)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <span>{label}</span>
              <span className="text-xs text-gray-500">{plural(rows.length)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
