import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { ClipboardPaste, LineChart as LineChartIcon, ListPlus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  addOutsideAccounts, deleteNetWorthPoint, getNetWorthHistory, getOutsideAccounts, importNetWorthPoints, pointBefore,
  saveNetWorthSnapshot, setNetWorthPoint,
} from '../../db/netWorth.js';
import { parseFidelityNetWorth, parseNetWorthHistory } from '../../db/netWorthParser.js';
import { Empty, ErrorNote, Kpi, Loading, Section, SuccessNote } from '../planning/ui';
import {
  dangerIconButtonClass,
  errorMessage,
  iconButtonClass,
  inputClass,
  money,
  moneyWhole,
  primaryButtonClass,
  secondaryButtonClass,
  todayIso,
  useDbData,
  useMutation,
} from '../planning/shared';
import type { DbApi, NetWorthHistoryPoint, NetWorthWithOutside, ParsedNetWorth } from '../../types';
import AccountBreakdown from './AccountBreakdown';

const NET_WORTH_COLOR = '#2563EB';
const RANGES = [
  { key: '3m', label: '3M', days: 92 },
  { key: '1y', label: '1Y', days: 366 },
  { key: '5y', label: '5Y', days: 1827 },
  { key: 'all', label: 'All', days: null },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];
type Panel = 'fidelity' | 'history' | 'figure' | null;

const textareaClass = `${inputClass} font-mono text-xs h-40 resize-y`;

const signedMoney = (value: number) => `${value >= 0 ? '+' : '−'}${moneyWhole(Math.abs(value))}`;
const dateLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
const DAY_MS = 86_400_000;
const toTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const isoOf = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Ticks on month or year boundaries, so the axis reads as a calendar. */
function timeTicks(start: number, end: number): { ticks: number[]; format: (time: number) => string } {
  const spanDays = (end - start) / DAY_MS;
  const first = new Date(start);
  if (spanDays > 3 * 366) {
    const ticks: number[] = [];
    for (let y = first.getUTCFullYear() + (first.getUTCMonth() > 0 || first.getUTCDate() > 1 ? 1 : 0); Date.UTC(y, 0, 1) <= end; y += 1) {
      ticks.push(Date.UTC(y, 0, 1));
    }
    return { ticks, format: (t) => String(new Date(t).getUTCFullYear()) };
  }
  const step = [1, 2, 3, 6].find((months) => spanDays / 30.4 / months <= 7) ?? 12;
  const ticks: number[] = [];
  const y = first.getUTCFullYear();
  let m = first.getUTCMonth() + (first.getUTCDate() > 1 ? 1 : 0);
  m = Math.ceil(m / step) * step;
  for (let t = Date.UTC(y, m, 1); t <= end; m += step, t = Date.UTC(y, m, 1)) ticks.push(t);
  return {
    ticks,
    format: (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }),
  };
}

const shortDateLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', year: '2-digit', day: 'numeric' });
};

function ChangeKpi({ history, days, label }: { history: NetWorthHistoryPoint[]; days: number; label: string }) {
  const latest = history[history.length - 1];
  const base = pointBefore(history, days);
  if (!latest || !base) return <Kpi label={label} value="—" hint="Not enough history yet" />;
  const change = latest.netWorth - base.netWorth;
  const pct = base.netWorth !== 0 ? ` (${change >= 0 ? '+' : '−'}${Math.abs((change / Math.abs(base.netWorth)) * 100).toFixed(1)}%)` : '';
  return (
    <Kpi
      label={label}
      value={signedMoney(change)}
      hint={`since ${dateLabel(base.date)}${pct}`}
      tone={change >= 0 ? 'good' : 'bad'}
    />
  );
}

export default function NetWorthHistorySection() {
  const today = todayIso();
  // Every total below includes the accounts outside Fidelity; `recorded` is the figure as saved.
  const load = useCallback(
    async (db: DbApi) => addOutsideAccounts(await getNetWorthHistory(db), await getOutsideAccounts(db)),
    [],
  );
  const { data: history, isLoading, error: loadError } = useDbData(load, [] as NetWorthWithOutside[]);
  const mutate = useMutation();

  const [panel, setPanel] = useState<Panel>(null);
  const [range, setRange] = useState<RangeKey>('1y');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Fidelity paste
  const [pageText, setPageText] = useState('');
  const [snapshotDate, setSnapshotDate] = useState('');
  const parsed: ParsedNetWorth | null = useMemo(
    () => (pageText.trim() ? parseFidelityNetWorth(pageText, { today }) : null),
    [pageText, today],
  );

  // History paste
  const [historyText, setHistoryText] = useState('');
  const parsedHistory = useMemo(() => parseNetWorthHistory(historyText), [historyText]);

  // Single figure
  const [editing, setEditing] = useState<NetWorthWithOutside | null>(null);
  const [figureDate, setFigureDate] = useState(today);
  const [figure, setFigure] = useState('');

  const openPanel = (next: Panel) => {
    setPanel(next);
    setError('');
    setNotice('');
    if (next === 'fidelity') {
      setPageText('');
      setSnapshotDate('');
    }
    if (next === 'history') setHistoryText('');
  };

  const openFigure = (point?: NetWorthWithOutside) => {
    openPanel('figure');
    setEditing(point ?? null);
    setFigureDate(point?.date ?? today);
    setFigure(point ? String(point.recorded) : '');
  };

  const run = async (change: (db: DbApi) => Promise<string>, failure: string) => {
    setIsSaving(true);
    setError('');
    try {
      const message = await mutate(change);
      setPanel(null);
      setEditing(null);
      setNotice(message);
    } catch (err) {
      setError(errorMessage(err, failure));
    } finally {
      setIsSaving(false);
    }
  };

  const effectiveSnapshotDate = snapshotDate || parsed?.date || today;
  const replacesDate = history.find((p) => p.date === effectiveSnapshotDate);

  const saveSnapshot = () => {
    if (!parsed) return;
    run(async (db) => {
      await saveNetWorthSnapshot(db, { ...parsed, date: effectiveSnapshotDate });
      return `Saved net worth of ${money(parsed.netWorth)} for ${dateLabel(effectiveSnapshotDate)}.`;
    }, 'Could not save the snapshot.');
  };

  const importHistory = () => {
    run(async (db) => {
      const result = await importNetWorthPoints(db, parsedHistory.points);
      const parts = [`Added ${result.added}`];
      if (result.updated) parts.push(`updated ${result.updated}`);
      if (result.keptSnapshots) parts.push(`kept ${result.keptSnapshots} pasted Fidelity snapshot${result.keptSnapshots === 1 ? '' : 's'}`);
      return `${parts.join(', ')}.`;
    }, 'Could not import the history.');
  };

  const saveFigure = (event: FormEvent) => {
    event.preventDefault();
    run(async (db) => {
      await setNetWorthPoint(db, { id: editing?.id ?? null, date: figureDate, netWorth: figure });
      return `Saved ${dateLabel(figureDate)}.`;
    }, 'Could not save the figure.');
  };

  const handleDelete = async (point: NetWorthHistoryPoint) => {
    const what = point.source === 'fidelity' ? 'pasted Fidelity snapshot' : 'figure';
    if (!window.confirm(`Delete the ${what} from ${dateLabel(point.date)}?`)) return;
    try {
      await mutate((db) => deleteNetWorthPoint(db, point.id));
    } catch (err) {
      setError(errorMessage(err, 'Could not delete it.'));
    }
  };

  const latest = history[history.length - 1];
  const rangeDays = RANGES.find((r) => r.key === range)?.days ?? null;
  const chartData = useMemo(() => {
    if (!latest) return [];
    if (rangeDays === null) return history;
    const start = new Date(`${latest.date}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - rangeDays);
    const startIso = start.toISOString().slice(0, 10);
    return history.filter((p) => p.date >= startIso);
  }, [history, latest, rangeDays]);
  // Points sit at their real dates, so a stretch with few figures still spans its time.
  const timeData = useMemo(() => chartData.map((p) => ({ ...p, time: toTime(p.date) })), [chartData]);
  const axis = useMemo(
    () => (timeData.length > 1 ? timeTicks(timeData[0].time, timeData[timeData.length - 1].time) : null),
    [timeData],
  );
  const newestFirst = [...history].reverse();
  const visible = showAll ? newestFirst : newestFirst.slice(0, 10);
  const latestSnapshot = [...history].reverse().find((p) => p.source === 'fidelity');
  const previousSnapshot = latestSnapshot
    ? [...history].reverse().find((p) => p.source === 'fidelity' && p.date < latestSnapshot.date)
    : undefined;

  const closeButton = (
    <button type="button" className={iconButtonClass} onClick={() => setPanel(null)} aria-label="Close">
      <X className="h-4 w-4" />
    </button>
  );

  return (
    <>
      <Section
        icon={LineChartIcon}
        title="Net worth history"
        description="Paste Fidelity Full View's Net worth page to record a dated snapshot, or backfill older totals."
        action={(
          <>
            <button type="button" className={primaryButtonClass} onClick={() => openPanel('fidelity')}>
              <ClipboardPaste className="h-4 w-4" aria-hidden="true" /> Paste from Fidelity
            </button>
            <button type="button" className={secondaryButtonClass} onClick={() => openPanel('history')}>
              <ListPlus className="h-4 w-4" aria-hidden="true" /> Paste history
            </button>
            <button type="button" className={secondaryButtonClass} onClick={() => openFigure()}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Add figure
            </button>
          </>
        )}
      >
        <ErrorNote message={loadError || (!panel ? error : '')} />
        {!panel && <SuccessNote message={notice} />}

        {panel === 'fidelity' && (
          <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Paste from Fidelity Full View</h3>
              {closeButton}
            </div>
            <p className="text-xs text-gray-500">
              On Fidelity, open Planning → Net worth, select the whole page (Ctrl+A), copy it and paste it here.
              Menus and disclaimers are ignored.
            </p>
            <ErrorNote message={error} />
            <textarea
              className={textareaClass}
              value={pageText}
              onChange={(e) => setPageText(e.target.value)}
              placeholder="Paste the Net worth page here"
              aria-label="Fidelity net worth page"
              autoFocus
            />
            {pageText.trim() && !parsed && (
              <p className="text-sm text-amber-800">This doesn't look like the Net worth page: no total or account lines were found.</p>
            )}
            {parsed && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <label className="text-sm text-gray-700 space-y-1 min-w-0">
                    <span className="block font-medium">As of</span>
                    <input
                      type="date"
                      value={effectiveSnapshotDate}
                      onChange={(e) => setSnapshotDate(e.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <Kpi label="Net worth" value={money(parsed.netWorth)} />
                  <Kpi label="Assets" value={money(parsed.assets)} />
                  <Kpi label="Liabilities" value={money(parsed.liabilities)} />
                </div>
                {parsed.warnings.map((warning) => (
                  <p key={warning} className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">{warning}</p>
                ))}
                <AccountBreakdown categories={parsed.categories} accounts={parsed.accounts} />
                {replacesDate && (
                  <p className="text-sm text-gray-600">
                    This replaces the {replacesDate.source === 'fidelity' ? 'snapshot' : 'figure'} already saved for {dateLabel(effectiveSnapshotDate)} ({money(replacesDate.recorded)}).
                  </p>
                )}
                <div className="flex gap-2 justify-end">
                  <button type="button" className={secondaryButtonClass} onClick={() => setPanel(null)}>Cancel</button>
                  <button type="button" className={primaryButtonClass} disabled={isSaving} onClick={saveSnapshot}>
                    {isSaving ? 'Saving…' : 'Save snapshot'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {panel === 'history' && (
          <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Paste historical totals</h3>
              {closeButton}
            </div>
            <p className="text-xs text-gray-500">
              One date and total per line, such as <code>10/12/2026 $397,784.74</code>, <code>2026-10-12, 397784.74</code> or <code>Jan 2023 $250K</code> (a month alone counts as its last day). You can also paste a chart's data as JSON, copied from the response in your browser's Network tab.
              Fidelity's chart "View as a table" copies in this shape too. Dates that already have a pasted Fidelity snapshot keep it.
            </p>
            <ErrorNote message={error} />
            <textarea
              className={textareaClass}
              value={historyText}
              onChange={(e) => setHistoryText(e.target.value)}
              placeholder={'01/31/2025 $310,000\n02/28/2025 $315,250.10'}
              aria-label="Historical net worth figures"
              autoFocus
            />
            {historyText.trim() && (
              <div className="text-sm text-gray-700 space-y-1">
                {parsedHistory.points.length > 0 ? (
                  <p>
                    Found {parsedHistory.points.length} figure{parsedHistory.points.length === 1 ? '' : 's'} from{' '}
                    {dateLabel(parsedHistory.points[0].date)} ({money(parsedHistory.points[0].netWorth)}) to{' '}
                    {dateLabel(parsedHistory.points[parsedHistory.points.length - 1].date)} ({money(parsedHistory.points[parsedHistory.points.length - 1].netWorth)}).
                  </p>
                ) : (
                  <p className="text-amber-800">No date and amount pairs found yet.</p>
                )}
                {parsedHistory.skipped.length > 0 && (
                  <p className="text-amber-800">
                    Skipped {parsedHistory.skipped.length} line{parsedHistory.skipped.length === 1 ? '' : 's'} that couldn't be read
                    (first: “{parsedHistory.skipped[0]}”).
                  </p>
                )}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" className={secondaryButtonClass} onClick={() => setPanel(null)}>Cancel</button>
              <button type="button" className={primaryButtonClass} disabled={isSaving || parsedHistory.points.length === 0} onClick={importHistory}>
                {isSaving ? 'Importing…' : `Import ${parsedHistory.points.length || ''} figure${parsedHistory.points.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}

        {panel === 'figure' && (
          <form onSubmit={saveFigure} className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">{editing ? 'Edit figure' : 'Add a net worth figure'}</h3>
              {closeButton}
            </div>
            <ErrorNote message={error} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm text-gray-700 space-y-1 min-w-0">
                <span className="block font-medium">Date</span>
                <input type="date" value={figureDate} max={today} onChange={(e) => setFigureDate(e.target.value)} className={inputClass} required />
              </label>
              <label className="text-sm text-gray-700 space-y-1 min-w-0">
                <span className="block font-medium">Total net worth</span>
                <input
                  inputMode="decimal"
                  value={figure}
                  onChange={(e) => setFigure(e.target.value)}
                  className={inputClass}
                  placeholder="$350,000"
                  required
                />
              </label>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" className={secondaryButtonClass} onClick={() => setPanel(null)}>Cancel</button>
              <button type="submit" className={primaryButtonClass} disabled={isSaving}>{isSaving ? 'Saving…' : 'Save figure'}</button>
            </div>
          </form>
        )}

        {isLoading && history.length === 0 ? (
          <Loading />
        ) : history.length === 0 ? (
          <Empty>No net worth history yet. Paste your Fidelity Net worth page, or paste older totals to backfill.</Empty>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <Kpi
                label="Net worth"
                value={moneyWhole(latest.netWorth)}
                hint={`as of ${dateLabel(latest.date)}${latest.outside ? `, incl. ${moneyWhole(latest.outside)} outside Fidelity` : ''}`}
              />
              <ChangeKpi history={history} days={90} label="Last 90 days" />
              <ChangeKpi history={history} days={365} label="Last 12 months" />
            </div>

            {history.length > 1 && (
              <>
                <div className="flex justify-end gap-1 mb-2" role="group" aria-label="Chart range">
                  {RANGES.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => setRange(r.key)}
                      aria-pressed={range === r.key}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium ${range === r.key ? 'bg-primary-50 text-primary-600' : 'text-gray-500 hover:bg-gray-100'}`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <div className="h-56 sm:h-72 -ml-2 mb-4">
                  {chartData.length > 1 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={timeData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                        <XAxis
                          dataKey="time"
                          type="number"
                          scale="time"
                          domain={['dataMin', 'dataMax']}
                          ticks={axis?.ticks}
                          tickFormatter={(t) => axis?.format(Number(t)) ?? shortDateLabel(isoOf(Number(t)))}
                          tick={{ fontSize: 11, fill: '#6B7280' }}
                          tickLine={false}
                          axisLine={false}
                          minTickGap={16}
                        />
                        <YAxis
                          tickFormatter={(v) => moneyWhole(v)}
                          tick={{ fontSize: 11, fill: '#6B7280' }}
                          tickLine={false}
                          axisLine={false}
                          width={80}
                          domain={['auto', 'auto']}
                        />
                        <Tooltip
                          formatter={(value, _name, item) => {
                            const outside = (item?.payload as NetWorthWithOutside | undefined)?.outside ?? 0;
                            return [`${money(Number(value))}${outside ? ` (incl. ${money(outside)} outside Fidelity)` : ''}`, 'Net worth'];
                          }}
                          labelFormatter={(label, payload) => {
                            const point = payload?.[0]?.payload as NetWorthWithOutside | undefined;
                            return `${dateLabel(point?.date ?? isoOf(Number(label)))}${point?.source === 'fidelity' ? ' · Fidelity snapshot' : ''}`;
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="netWorth"
                          name="Net worth"
                          stroke={NET_WORTH_COLOR}
                          strokeWidth={2}
                          dot={chartData.length <= 60 ? { r: 3 } : false}
                          activeDot={{ r: 5 }}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <Empty>Only one figure in this range. Pick a longer range.</Empty>
                  )}
                </div>
              </>
            )}

            <h3 className="text-sm font-semibold text-gray-700 mb-1">Recorded figures</h3>
            <ul className="divide-y divide-gray-100">
              {visible.map((point) => (
                <li key={point.id} className="py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{dateLabel(point.date)}</p>
                    <p className="text-xs text-gray-500">
                      {point.source === 'fidelity'
                        ? `Fidelity snapshot · ${point.accounts.length} accounts`
                        : 'Entered by hand'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <div className="text-right mr-1">
                      <p className={`tabular-nums text-sm font-medium ${point.recorded < 0 ? 'text-red-700' : 'text-gray-900'}`}>{money(point.recorded)}</p>
                      {point.outside !== 0 && (
                        <p className="tabular-nums text-xs text-gray-500">{point.outside > 0 ? '+' : '−'}{money(Math.abs(point.outside))} outside Fidelity</p>
                      )}
                    </div>
                    {point.source === 'manual' && (
                      <button type="button" className={iconButtonClass} onClick={() => openFigure(point)} aria-label={`Edit the figure from ${point.date}`}>
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    <button type="button" className={dangerIconButtonClass} onClick={() => handleDelete(point)} aria-label={`Delete the figure from ${point.date}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {history.length > 10 && (
              <button type="button" className="text-sm text-primary-600 hover:underline mt-2" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show fewer' : `Show all ${history.length}`}
              </button>
            )}
          </>
        )}
      </Section>

      {latestSnapshot && (
        <Section
          title="Accounts"
          description={`From the Fidelity snapshot of ${dateLabel(latestSnapshot.date)}${previousSnapshot ? `, with changes since ${dateLabel(previousSnapshot.date)}` : ''}.`}
        >
          <AccountBreakdown
            categories={latestSnapshot.categories}
            accounts={latestSnapshot.accounts}
            previous={previousSnapshot?.accounts}
            assets={latestSnapshot.assets}
            liabilities={latestSnapshot.liabilities}
          />
          {Object.keys(latestSnapshot.outsideByAccount).length > 0 && (
            <div className="mt-4 min-w-0">
              <div className="flex items-baseline justify-between border-b border-gray-200 pb-1 mb-1">
                <h4 className="text-sm font-semibold text-gray-900">Outside Fidelity</h4>
                <span className="tabular-nums text-sm font-semibold text-gray-900">{money(latestSnapshot.outside)}</span>
              </div>
              <ul className="divide-y divide-gray-100">
                {Object.entries(latestSnapshot.outsideByAccount).map(([name, value]) => (
                  <li key={name} className="py-1.5 flex items-start justify-between gap-3">
                    <p className="text-sm text-gray-900 truncate">{name}</p>
                    <p className={`tabular-nums text-sm ${value < 0 ? 'text-red-700' : 'text-gray-900'}`}>{money(value)}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}
    </>
  );
}
