import { useCallback, useState } from 'react';
import { PiggyBank } from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { getMonthlySavingsRate, getYearSummary } from '../../db/features.js';
import { Empty, ErrorNote, Kpi, Loading, Section } from './ui';
import { money, moneyWhole, monthLabel, percent, todayIso, useDbData } from './shared';
import type { DbApi, MonthlySavings } from '../../types';

type Data = { series: MonthlySavings[]; yearRate: number | null; yearIncome: number; yearSpent: number };

const INCOME_COLOR = '#10B981';
const SPENT_COLOR = '#64748B';
const RATE_COLOR = '#2563EB';

const RANGES = [6, 12, 24] as const;

const rateTone = (rate: number | null) => (rate === null ? 'neutral' : rate < 0 ? 'bad' : rate >= 0.2 ? 'good' : 'neutral');

export default function SavingsRateSection() {
  const today = todayIso();
  const [months, setMonths] = useState<number>(12);
  const load = useCallback(async (db: DbApi): Promise<Data> => {
    const [series, year] = await Promise.all([
      getMonthlySavingsRate(db, { months, today }),
      getYearSummary(db, Number(today.slice(0, 4))),
    ]);
    return { series, yearRate: year.savingsRate, yearIncome: year.income, yearSpent: year.netSpent };
  }, [months, today]);
  const { data, isLoading, error } = useDbData(load, { series: [], yearRate: null, yearIncome: 0, yearSpent: 0 } as Data);

  const current = data.series[data.series.length - 1];
  const totals = data.series.reduce((acc, p) => ({ income: acc.income + p.income, spent: acc.spent + p.spent }), { income: 0, spent: 0 });
  const rangeRate = totals.income > 0 ? (totals.income - totals.spent) / totals.income : null;
  const hasData = data.series.some((p) => p.income > 0 || p.spent > 0);
  const chartData = data.series.map((p) => ({
    ...p,
    label: monthLabel(p.month),
    ratePct: p.savingsRate === null ? null : Math.round(p.savingsRate * 1000) / 10,
  }));

  return (
    <Section
      icon={PiggyBank}
      title="Savings rate"
      description="Share of income left after spending. Uses the same income and spending rules as Analytics."
      action={(
        <div className="inline-flex bg-gray-100 p-1 rounded-lg" role="group" aria-label="Months shown">
          {RANGES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setMonths(n)}
              aria-pressed={months === n}
              className={`px-3 py-1.5 text-sm font-medium rounded-md ${months === n ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {n}m
            </button>
          ))}
        </div>
      )}
    >
      <ErrorNote message={error} />
      {isLoading && data.series.length === 0 ? (
        <Loading />
      ) : !hasData ? (
        <Empty>No income or spending in this period yet.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
            <Kpi
              label="This month"
              value={percent(current?.savingsRate ?? null)}
              tone={rateTone(current?.savingsRate ?? null)}
              hint={current ? `${moneyWhole(current.saved)} saved so far` : undefined}
            />
            <Kpi
              label={`${today.slice(0, 4)} so far`}
              value={percent(data.yearRate)}
              tone={rateTone(data.yearRate)}
              hint={`${moneyWhole(data.yearIncome - data.yearSpent)} saved`}
            />
            <Kpi label={`Last ${months} months`} value={percent(rangeRate)} tone={rateTone(rangeRate)} hint={`${moneyWhole(totals.income - totals.spent)} saved`} />
          </div>

          <h3 className="text-sm font-semibold text-gray-700 mb-2">Income and spending</h3>
          <div className="h-56 sm:h-64 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barGap={2} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8} />
                <YAxis tickFormatter={(v) => moneyWhole(v)} tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} width={64} />
                <Tooltip formatter={(value, name) => [money(Number(value)), name]} cursor={{ fill: '#F3F4F6' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="income" name="Income" fill={INCOME_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} />
                <Bar dataKey="spent" name="Spending" fill={SPENT_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <h3 className="text-sm font-semibold text-gray-700 mt-5 mb-2">Savings rate by month</h3>
          <div className="h-44 sm:h-52 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8} />
                <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} width={48} />
                <ReferenceLine y={0} stroke="#9CA3AF" />
                <Tooltip formatter={(value) => [`${value}%`, 'Savings rate']} />
                <Line type="monotone" dataKey="ratePct" name="Savings rate" stroke={RATE_COLOR} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-gray-500 mt-2">Months with no income have no savings rate.</p>
        </>
      )}
    </Section>
  );
}
