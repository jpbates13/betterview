import { useCallback, useEffect, useState } from 'react';
import { useDatabase } from '../../useDatabase';
import type { DbApi } from '../../types';

export const errorMessage = (err: unknown, fallback = 'Something went wrong.'): string => {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
};

/** Loads data from the database and reloads it whenever the data changes. */
export function useDbData<T>(load: (db: DbApi) => Promise<T>, initial: T) {
  const { db, isReady, dataVersion } = useDatabase();
  // Remembers which request produced the current data, so "loading" is derived rather than set.
  const [state, setState] = useState<{ data: T; error: string; source: unknown[] | null }>({
    data: initial,
    error: '',
    source: null,
  });

  useEffect(() => {
    if (!db || !isReady) return undefined;
    let cancelled = false;
    const source = [db, dataVersion, load];
    load(db)
      .then((data) => {
        if (!cancelled) setState({ data, error: '', source });
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setState((prev) => ({ ...prev, error: errorMessage(err, 'Could not load this data.'), source }));
      });
    return () => {
      cancelled = true;
    };
  }, [db, isReady, dataVersion, load]);

  const isLoading = !state.source
    || state.source[0] !== db
    || state.source[1] !== dataVersion
    || state.source[2] !== load;
  return { data: state.data, error: state.error, isLoading };
}

/** Runs a change against the database, then refreshes every page and queues a Drive sync. */
export function useMutation() {
  const { db, triggerMutation, notifyDataChanged } = useDatabase();
  return useCallback(async <T,>(change: (db: DbApi) => Promise<T>): Promise<T> => {
    if (!db) throw new Error('The database is still loading.');
    const result = await change(db);
    triggerMutation();
    notifyDataChanged();
    return result;
  }, [db, triggerMutation, notifyDataChanged]);
}

const moneyFormat = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
const moneyFormatWhole = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const money = (value: number) => moneyFormat.format(Number(value) || 0);
export const moneyWhole = (value: number) => moneyFormatWhole.format(Number(value) || 0);
export const percent = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`;

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const monthLabel = (month: string, style: 'short' | 'long' = 'short') => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: style, year: style === 'long' ? 'numeric' : '2-digit' });
};

export const downloadFile = (contents: BlobPart, fileName: string, type: string) => {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const inputClass =
  'w-full min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none';
export const primaryButtonClass =
  'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
export const secondaryButtonClass =
  'inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
export const iconButtonClass =
  'inline-flex items-center justify-center h-9 w-9 shrink-0 rounded-lg text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-colors';
export const dangerIconButtonClass =
  'inline-flex items-center justify-center h-9 w-9 shrink-0 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors';
