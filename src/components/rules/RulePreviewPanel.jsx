import { Eye } from 'lucide-react';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const plural = (count, word) => `${count} existing ${word}${count === 1 ? '' : 's'}`;

/** Live "what would this rule do" panel for the rule editor. */
export default function RulePreviewPanel({ preview, maxRows = 200 }) {
  const { status, rows, error } = preview;

  let headline;
  if (status === 'idle') {
    headline = 'Enter a condition value to see which transactions this rule matches.';
  } else if (status === 'error') {
    headline = error;
  } else if (status === 'loading' && rows.length === 0) {
    headline = 'Checking existing transactions…';
  } else {
    headline = (
      <>
        This rule matches <span className="font-semibold text-gray-900">{plural(rows.length, 'transaction')}</span>
      </>
    );
  }

  const shown = rows.slice(0, maxRows);

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60" aria-live="polite">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200">
        <Eye className="h-4 w-4 text-gray-500 shrink-0" />
        <p className={`text-sm min-w-0 ${status === 'error' ? 'text-amber-700' : 'text-gray-700'}`}>{headline}</p>
        {status === 'loading' && (
          <span className="ml-auto h-3.5 w-3.5 shrink-0 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" aria-label="Updating preview" />
        )}
      </div>
      {shown.length > 0 && (
        <ul className={`max-h-64 overflow-y-auto divide-y divide-gray-100 ${status === 'loading' ? 'opacity-60' : ''}`}>
          {shown.map((row) => (
            <li key={row.id} className="px-3 py-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium text-gray-900" title={row.description}>
                  {row.merchant || row.description}
                </span>
                <span className={`shrink-0 tabular-nums ${row.amount < 0 ? 'text-gray-900' : 'text-emerald-700'}`}>
                  {currency.format(row.amount)}
                </span>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 mt-0.5 text-xs">
                <span className="text-gray-500 min-w-0 truncate">
                  {row.date}{row.merchant && row.merchant !== row.description ? ` · ${row.description}` : ''}
                </span>
                <span className={row.change === 'already in category' ? 'text-gray-400' : 'text-primary-700 font-medium'}>
                  {row.change}
                </span>
              </div>
            </li>
          ))}
          {rows.length > shown.length && (
            <li className="px-3 py-2 text-xs text-gray-500">…and {rows.length - shown.length} more</li>
          )}
        </ul>
      )}
    </div>
  );
}
