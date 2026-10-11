import { useEffect, useRef } from 'react';
import { Play, X } from 'lucide-react';

/**
 * Confirmation for "Run on existing transactions". `matchCount` is null while
 * the preview is still being computed.
 */
export default function RunRuleDialog({ rule, matchCount, changeCount, error, isRunning, onConfirm, onCancel }) {
  const confirmRef = useRef(null);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !isRunning) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isRunning, onCancel]);

  useEffect(() => {
    if (matchCount !== null) confirmRef.current?.focus();
  }, [matchCount]);

  const loading = matchCount === null && !error;
  const noun = (n) => `${n} existing transaction${n === 1 ? '' : 's'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 p-4" onClick={isRunning ? undefined : onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-rule-title"
        className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-gray-100"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <h2 id="run-rule-title" className="text-lg font-semibold text-gray-900 min-w-0 break-words">
            Run “{rule.name}”?
          </h2>
          <button type="button" onClick={onCancel} disabled={isRunning} className="p-1 -m-1 text-gray-400 hover:text-gray-600 rounded" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4 text-sm text-gray-600 space-y-2">
          {loading && <p>Counting matching transactions…</p>}
          {error && <p className="text-red-700">{error}</p>}
          {matchCount !== null && (
            <>
              <p>
                This rule matches <span className="font-semibold text-gray-900">{noun(matchCount)}</span>.
              </p>
              {matchCount > 0 && changeCount !== null && changeCount < matchCount && (
                <p className="text-gray-500">{matchCount - changeCount} already have the target category.</p>
              )}
              {matchCount > 0 && (
                <p className="text-gray-500">
                  {rule.action_type === 'split'
                    ? 'Each one will be hidden and replaced by its split lines.'
                    : 'Their category will be overwritten.'}
                </p>
              )}
            </>
          )}
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={isRunning}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={isRunning || loading || Boolean(error) || matchCount === 0}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-60"
          >
            {isRunning
              ? <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <Play className="h-4 w-4" />}
            {matchCount ? `Apply to ${matchCount}` : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
