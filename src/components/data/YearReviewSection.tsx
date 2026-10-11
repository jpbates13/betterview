import { useCallback, useState } from 'react';
import { CalendarRange, Download } from 'lucide-react';
import { getTagSummary, getYearSummary, transactionsToCsv } from '../../db/features.js';
import { getTransactions } from '../../dbQueries.js';
import { Empty, ErrorNote, Kpi, Loading, Section } from '../planning/ui';
import { downloadFile, errorMessage, inputClass, money, moneyWhole, percent, primaryButtonClass, todayIso, useDb, useDbData } from '../planning/shared';
import type { Db } from '../planning/shared';

type Summary = {
  year: number;
  income: number;
  grossExpenses: number;
  netSpent: number;
  savingsRate: number | null;
  categories: { category: string; spent: number }[];
  topMerchants: { merchant: string; count: number; spent: number }[];
};
type Tag = { tag: string; count: number; total: number };
type Data = { summary: Summary | null; tags: Tag[]; years: number[] };

const SUGGESTED_TAGS = ['tax-deductible', 'charitable', 'medical'];

export default function YearReviewSection() {
  const currentYear = Number(todayIso().slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [tag, setTag] = useState('');
  const [exportError, setExportError] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  const load = useCallback(async (db: Db): Promise<Data> => {
    const [summary, tags, yearRows] = await Promise.all([
      getYearSummary(db, year),
      getTagSummary(db, { startDate: `${year}-01-01`, endDate: `${year}-12-31` }),
      db.exec("SELECT DISTINCT CAST(strftime('%Y', date) AS INTEGER) FROM transactions WHERE is_hidden = 0 AND date IS NOT NULL ORDER BY 1 DESC;"),
    ]);
    const years = ((yearRows[0] as { values?: unknown[][] } | undefined)?.values ?? [])
      .map((row) => Number(row[0]))
      .filter((y) => Number.isFinite(y) && y > 1900);
    return { summary: summary as Summary, tags: tags as Tag[], years };
  }, [year]);
  const { data, isLoading, error } = useDbData(load, { summary: null, tags: [], years: [] } as Data);
  const { db } = useDb();

  const handleExport = async () => {
    if (!db) return;
    setIsExporting(true);
    setExportError('');
    try {
      const filters = { startDate: `${year}-01-01`, endDate: `${year}-12-31`, tag: tag || undefined };
      const rows = await getTransactions(db, filters as unknown as Parameters<typeof getTransactions>[1]);
      if (rows.length === 0) {
        setExportError(`No ${tag ? `transactions tagged ${tag}` : 'transactions'} in ${year} to export.`);
        return;
      }
      const ordered = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.id) - Number(b.id));
      downloadFile(transactionsToCsv(ordered), `betterview-${year}${tag ? `-${tag}` : ''}.csv`, 'text/csv;charset=utf-8');
    } catch (err) {
      setExportError(errorMessage(err, 'Could not export the transactions.'));
    } finally {
      setIsExporting(false);
    }
  };

  const yearOptions = [...new Set([currentYear, year, ...data.years])].sort((a, b) => b - a);
  const tagOptions = [...new Set([...data.tags.map((t) => t.tag), ...SUGGESTED_TAGS])];
  const tagInfo = (name: string) => data.tags.find((t) => t.tag === name);
  const selectedTag = tag ? tagInfo(tag) : null;
  const summary = data.summary;
  const maxCategory = summary?.categories[0]?.spent || 1;

  return (
    <Section
      icon={CalendarRange}
      title="Year in review & tax export"
      description="A summary of one year, and its transactions as a CSV for taxes or your records."
      action={(
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={`${inputClass} w-auto`} aria-label="Year">
          {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      )}
    >
      <ErrorNote message={error || exportError} />
      {isLoading && !summary ? (
        <Loading />
      ) : !summary ? null : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <Kpi label="Income" value={moneyWhole(summary.income)} />
            <Kpi label="Spending" value={moneyWhole(summary.netSpent)} hint={summary.grossExpenses !== summary.netSpent ? `${moneyWhole(summary.grossExpenses)} before reimbursements` : undefined} />
            <Kpi label="Saved" value={moneyWhole(summary.income - summary.netSpent)} tone={summary.income - summary.netSpent < 0 ? 'bad' : 'neutral'} />
            <Kpi
              label="Savings rate"
              value={percent(summary.savingsRate)}
              tone={summary.savingsRate === null ? 'neutral' : summary.savingsRate < 0 ? 'bad' : summary.savingsRate >= 0.2 ? 'good' : 'neutral'}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Spending by category</h3>
              {summary.categories.length === 0 ? (
                <Empty>No spending in {year}.</Empty>
              ) : (
                <ul className="space-y-2">
                  {summary.categories.map((row) => (
                    <li key={row.category}>
                      <div className="flex justify-between gap-2 text-sm">
                        <span className="text-gray-800 truncate">{row.category || 'Uncategorized'}</span>
                        <span className="tabular-nums text-gray-900 shrink-0">
                          {money(row.spent)}
                          {summary.netSpent > 0 && <span className="text-gray-400"> · {percent(row.spent / summary.netSpent)}</span>}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 mt-1" aria-hidden="true">
                        <div className="h-full rounded-full bg-primary-500" style={{ width: `${(row.spent / maxCategory) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="min-w-0 space-y-6">
              {summary.topMerchants.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Top merchants</h3>
                  <ul className="divide-y divide-gray-100 text-sm">
                    {summary.topMerchants.slice(0, 5).map((m) => (
                      <li key={m.merchant} className="py-1.5 flex justify-between gap-2">
                        <span className="truncate text-gray-800">{m.merchant}</span>
                        <span className="tabular-nums text-gray-900 shrink-0">{money(m.spent)} <span className="text-gray-400">· {m.count}×</span></span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Export {year} to CSV</h3>
                <label className="text-sm text-gray-700 block space-y-1">
                  <span className="block font-medium">Transactions</span>
                  <select value={tag} onChange={(e) => setTag(e.target.value)} className={inputClass}>
                    <option value="">All transactions</option>
                    {tagOptions.map((name) => {
                      const info = tagInfo(name);
                      return (
                        <option key={name} value={name}>
                          Tagged {name}{info ? ` (${info.count})` : ' (none)'}
                        </option>
                      );
                    })}
                  </select>
                </label>
                {tag && (
                  <p className="text-sm text-gray-600 mt-2 tabular-nums">
                    {selectedTag
                      ? <>{selectedTag.count} transaction{selectedTag.count === 1 ? '' : 's'} totalling <span className="font-semibold text-gray-900">{money(Math.abs(selectedTag.total))}</span>{selectedTag.total > 0 ? ' received' : ''}</>
                      : <>No transactions tagged {tag} in {year}. Tag them from the Transactions page.</>}
                  </p>
                )}
                <button
                  type="button"
                  className={`${primaryButtonClass} w-full sm:w-auto mt-3`}
                  onClick={handleExport}
                  disabled={isExporting || (Boolean(tag) && !selectedTag)}
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  {isExporting ? 'Exporting…' : 'Download CSV'}
                </button>
              </div>

              {data.tags.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Tag totals for {year}</h3>
                  <ul className="divide-y divide-gray-100 text-sm">
                    {data.tags.map((t) => (
                      <li key={t.tag} className="py-1.5 flex justify-between gap-2">
                        <span className="truncate text-gray-800">{t.tag}</span>
                        <span className="tabular-nums text-gray-900 shrink-0">{money(t.total)} <span className="text-gray-400">· {t.count}</span></span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </Section>
  );
}
