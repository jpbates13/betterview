import { useEffect, useState } from 'react';
import { previewRule } from '../../dbQueries.js';

const IDLE = { key: null, rows: [], error: null };

/**
 * Debounced previewRule for a rule that is still being edited.
 * `rule` may be null (nothing to preview yet). `refreshToken` re-runs the
 * preview when the underlying data changes (e.g. dataVersion).
 */
export function useRulePreview(db, rule, { delay = 300, refreshToken = 0 } = {}) {
  const key = rule && db ? `${refreshToken}|${JSON.stringify(rule)}` : null;
  const [result, setResult] = useState(IDLE);

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    const draft = JSON.parse(key.slice(key.indexOf('|') + 1));
    const timer = setTimeout(async () => {
      try {
        const rows = await previewRule(db, draft);
        if (!cancelled) setResult({ key, rows, error: null });
      } catch (error) {
        if (!cancelled) setResult({ key, rows: [], error: error?.message || 'Could not preview this rule.' });
      }
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [db, key, delay]);

  if (!key) return { status: 'idle', rows: [], error: null };
  if (result.key !== key) {
    // Keep showing the last result while the next one is computed.
    return { status: 'loading', rows: result.rows, error: null };
  }
  return { status: result.error ? 'error' : 'ready', rows: result.rows, error: result.error };
}
