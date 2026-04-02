import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format, parseISO } from 'date-fns';

type SpikeTransaction = {
    id: number;
    date: string;
    description: string;
    category: string;
    account: string;
    amount: number;
    spend_impact: number;
};

type PacingData = {
    day: number;
    current_date?: string;
    previous_date?: string;
    current_day_spend?: number;
    previous_day_spend?: number;
    current_day_income?: number;
    previous_day_income?: number;
    current_top_transaction?: SpikeTransaction;
    previous_top_transaction?: SpikeTransaction;
    current_spike_marker?: number;
    previous_spike_marker?: number;
    current_is_spike?: boolean;
    previous_is_spike?: boolean;
    current_spend?: number;
    previous_spend?: number;
    current_income?: number;
    previous_income?: number;
};

const formatIsoDate = (isoDate?: string) => {
    if (!isoDate) return '';
    try {
        return format(parseISO(isoDate), 'MMM d, yyyy');
    } catch {
        return isoDate;
    }
};

const quantile = (values: number[], q: number) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    const next = sorted[base + 1] ?? sorted[base];
    return sorted[base] + rest * (next - sorted[base]);
};

const getSpikeDays = (
    points: PacingData[],
    daySpendKey: 'current_day_spend' | 'previous_day_spend',
    topTxKey: 'current_top_transaction' | 'previous_top_transaction'
) => {
    const positiveDaySpends = points
        .map(point => Number(point[daySpendKey] ?? 0))
        .filter(v => Number.isFinite(v) && v > 0);

    if (positiveDaySpends.length < 5) return new Set<number>();

    const median = quantile(positiveDaySpends, 0.5);
    const p90 = quantile(positiveDaySpends, 0.9);
    const mean = positiveDaySpends.reduce((sum, value) => sum + value, 0) / positiveDaySpends.length;
    const threshold = Math.max(100, p90 * 1.35, median * 3, mean * 2.5);
    const maxMarkers = Math.max(3, Math.min(8, Math.ceil(Math.sqrt(positiveDaySpends.length))));

    const candidates = points
        .map(point => {
            const daySpend = Number(point[daySpendKey] ?? 0);
            const topTx = point[topTxKey];

            if (!topTx || daySpend < threshold) return null;

            const singularShare = topTx.spend_impact / daySpend;
            if (singularShare < 0.7 || topTx.spend_impact < threshold * 0.75) {
                return null;
            }

            return {
                day: point.day,
                score: daySpend * singularShare,
            };
        })
        .filter((candidate): candidate is { day: number; score: number } => candidate !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxMarkers);

    return new Set(candidates.map(candidate => candidate.day));
};

const CustomTooltip = ({ active, payload, label, hiddenBars = {}, filter, showSpikeMarkers = false, comparisonMode = 'previous-period', paceMode = 'expense' }: any) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        const isModeExpense = paceMode === 'expense';
        return (
            <div className="bg-white rounded-lg shadow-md p-4 border border-gray-100 z-50">
                <p className="font-medium text-gray-900 mb-3">{filter === 'All Time' ? '' : `Day ${label}`}</p>
                <div className="space-y-2">
                    {!hiddenBars.current_spend && (isModeExpense ? data.current_spend : data.current_income) !== undefined && (
                        <div className="flex items-start gap-4 justify-between w-full min-w-[200px]">
                            <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-[#3B82F6]" />
                                    <span className="text-gray-700 font-semibold">Current Period</span>
                                </div>
                                {data.current_date && <span className="text-xs text-gray-500 ml-5">{formatIsoDate(data.current_date)}</span>}
                            </div>
                            <span className="font-bold text-gray-900 mt-0.5">
                                ${(isModeExpense ? data.current_spend : data.current_income).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                        </div>
                    )}

                    {!hiddenBars.current_spend && !hiddenBars.previous_spend && (isModeExpense ? data.current_spend : data.current_income) !== undefined && (isModeExpense ? data.previous_spend : data.previous_income) !== undefined && (
                        <div className="border-t border-gray-100 my-2" />
                    )}

                    {!hiddenBars.previous_spend && (isModeExpense ? data.previous_spend : data.previous_income) !== undefined && (
                        <div className="flex items-start gap-4 justify-between w-full min-w-[200px]">
                            <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-[#94A3B8]" />
                                    <span className="text-gray-700 font-semibold">{comparisonMode === 'previous-year' ? 'Previous Year' : 'Previous Period'}</span>
                                </div>
                                {data.previous_date && <span className="text-xs text-gray-500 ml-5">{formatIsoDate(data.previous_date)}</span>}
                            </div>
                            <span className="font-bold text-gray-900 mt-0.5">
                                ${(isModeExpense ? data.previous_spend : data.previous_income).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                        </div>
                    )}

                    {showSpikeMarkers && !hiddenBars.current_spend && isModeExpense && data.current_is_spike && data.current_top_transaction && (
                        <div className="border-t border-gray-100 pt-2 mt-2">
                            <div className="flex items-center gap-2 mb-1">
                                <div className="w-3 h-3 rounded-full bg-[#DC2626]" />
                                <span className="text-gray-700 font-semibold">Current Spike Transaction</span>
                            </div>
                            <p className="text-sm text-gray-900">{data.current_top_transaction.description}</p>
                            <p className="text-xs text-gray-500">{data.current_top_transaction.category} • {data.current_top_transaction.account}</p>
                            <p className="text-sm font-semibold text-red-600 mt-1">Impact: ${data.current_top_transaction.spend_impact.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                    )}

                    {showSpikeMarkers && !hiddenBars.previous_spend && isModeExpense && data.previous_is_spike && data.previous_top_transaction && (
                        <div className="border-t border-gray-100 pt-2 mt-2">
                            <div className="flex items-center gap-2 mb-1">
                                <div className="w-3 h-3 rounded-full bg-[#DC2626]" />
                                <span className="text-gray-700 font-semibold">Previous Spike Transaction</span>
                            </div>
                            <p className="text-sm text-gray-900">{data.previous_top_transaction.description}</p>
                            <p className="text-xs text-gray-500">{data.previous_top_transaction.category} • {data.previous_top_transaction.account}</p>
                            <p className="text-sm font-semibold text-red-600 mt-1">Impact: ${data.previous_top_transaction.spend_impact.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }
    return null;
};

export default function SpendPacingChart({ data, filter, showSpikeMarkers = false, comparisonMode = 'previous-period' }: { data: PacingData[], filter: string, showSpikeMarkers?: boolean, comparisonMode?: 'previous-period' | 'previous-year' }) {
    const [hiddenBars, setHiddenBars] = useState<Record<string, boolean>>({});
    const [paceMode, setPaceMode] = useState<'expense' | 'income'>('expense');
    const currentSpikeDays = useMemo(
        () => (showSpikeMarkers && paceMode === 'expense' ? getSpikeDays(data, 'current_day_spend', 'current_top_transaction') : new Set<number>()),
        [data, showSpikeMarkers, paceMode]
    );
    const previousSpikeDays = useMemo(
        () => (showSpikeMarkers && paceMode === 'expense' ? getSpikeDays(data, 'previous_day_spend', 'previous_top_transaction') : new Set<number>()),
        [data, showSpikeMarkers, paceMode]
    );
    const chartData = useMemo(
        () => data.map((point) => {
            const currentIsSpike = currentSpikeDays.has(point.day);
            const previousIsSpike = previousSpikeDays.has(point.day);
            const currentValue = paceMode === 'income' ? point.current_income : point.current_spend;
            const previousValue = paceMode === 'income' ? point.previous_income : point.previous_spend;
            return {
                ...point,
                current_is_spike: currentIsSpike,
                previous_is_spike: previousIsSpike,
                current_spike_marker: currentIsSpike ? currentValue : undefined,
                previous_spike_marker: previousIsSpike ? previousValue : undefined,
            };
        }),
        [data, currentSpikeDays, previousSpikeDays, paceMode]
    );
    const maxDay = data.length > 0 ? data[data.length - 1].day : 1;

    useEffect(() => {
        setHiddenBars({});
    }, [filter, data.length]);

    const handleLegendClick = (e: any) => {
        const dataKey = e.dataKey;
        setHiddenBars(prev => ({
            ...prev,
            [dataKey]: !prev[dataKey]
        }));
    };

    const currentDataKey = paceMode === 'income' ? 'current_income' : 'current_spend';
    const previousDataKey = paceMode === 'income' ? 'previous_income' : 'previous_spend';
    const currentLegendName = paceMode === 'income' ? 'Current Income' : 'Current Period';
    const previousLegendName = paceMode === 'income' 
        ? (comparisonMode === 'previous-year' ? 'Previous Year Income' : 'Previous Period Income')
        : (comparisonMode === 'previous-year' ? 'Previous Year' : 'Previous Period');

    return (
        <div className="flex flex-col h-full w-full">
            <div className="flex gap-2 mb-4">
                <button
                    onClick={() => setPaceMode('expense')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        paceMode === 'expense'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                >
                    Expenses
                </button>
                <button
                    onClick={() => setPaceMode('income')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        paceMode === 'income'
                            ? 'bg-green-600 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                >
                    Income
                </button>
            </div>
            <div className="flex-grow">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                        data={chartData}
                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                        <XAxis
                            dataKey="day"
                            type="number"
                            domain={[1, maxDay]}
                            allowDecimals={false}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: '#6B7280', fontSize: 12 }}
                            dy={10}
                            tickFormatter={(val) => filter === 'All Time' ? '' : `Day ${val}`}
                        />
                        <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: '#6B7280', fontSize: 12 }}
                            tickFormatter={(val) => `$${val.toLocaleString()}`}
                            width={80}
                        />
                        <Tooltip content={<CustomTooltip hiddenBars={hiddenBars} filter={filter} showSpikeMarkers={showSpikeMarkers} comparisonMode={comparisonMode} paceMode={paceMode} />} cursor={{ stroke: '#E5E7EB', strokeWidth: 2 }} />
                        <Legend
                            wrapperStyle={{ paddingTop: '20px' }}
                            iconType="circle"
                            onClick={handleLegendClick}
                            cursor="pointer"
                        />
                        <Line
                            type="monotone"
                            dataKey={currentDataKey}
                            name={currentLegendName}
                            hide={hiddenBars.current_spend}
                            stroke={paceMode === 'income' ? '#10B981' : '#3B82F6'}
                            strokeWidth={3}
                            dot={false}
                            activeDot={{ r: 6 }}
                        />
                        {showSpikeMarkers && (
                            <Line
                                type="linear"
                                dataKey="current_spike_marker"
                                hide={hiddenBars.current_spend}
                                stroke="transparent"
                                dot={{ r: 4, fill: '#DC2626', stroke: '#FFFFFF', strokeWidth: 1.5 }}
                                activeDot={{ r: 6, fill: '#DC2626', stroke: '#FFFFFF', strokeWidth: 2 }}
                                isAnimationActive={false}
                                legendType="none"
                            />
                        )}
                        {filter !== 'All Time' && (
                            <>
                                <Line
                                    type="monotone"
                                    dataKey={previousDataKey}
                                    name={previousLegendName}
                                    hide={hiddenBars.previous_spend}
                                    stroke={paceMode === 'income' ? '#6EE7B7' : '#94A3B8'}
                                    strokeWidth={3}
                                    strokeDasharray="6 6"
                                    dot={false}
                                    activeDot={{ r: 6 }}
                                />
                                {showSpikeMarkers && (
                                    <Line
                                        type="linear"
                                        dataKey="previous_spike_marker"
                                        hide={hiddenBars.previous_spend}
                                        stroke="transparent"
                                        dot={{ r: 4, fill: '#DC2626', stroke: '#FFFFFF', strokeWidth: 1.5 }}
                                        activeDot={{ r: 6, fill: '#DC2626', stroke: '#FFFFFF', strokeWidth: 2 }}
                                        isAnimationActive={false}
                                        legendType="none"
                                    />
                                )}
                            </>
                        )}
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
