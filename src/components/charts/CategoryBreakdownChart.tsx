import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, type PieSectorDataItem } from 'recharts';

import type { CategorySpending, CategoryTotal } from '../../types';

type CategoryData = CategoryTotal;
type BreakdownData = CategorySpending;

const money = (value: number, digits = 2) => `$${value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

type CategoryBreakdownChartProps = {
  data: BreakdownData;
  onCategoryClick?: (category: string) => void;
  total_income?: number;
};

// Cohesive modern Tailwind palette (indigo, violet, blue, sky, teal, amber, rose, slate)
const COLORS = ['#6366f1', '#8b5cf6', '#3b82f6', '#0ea5e9', '#14b8a6', '#f59e0b', '#f43f5e', '#64748b'];

type Slice = CategoryData & { absTotal: number; percentage: number };

type CategoryTooltipProps = {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: Slice }>;
};

const CustomTooltip = ({ active, payload }: CategoryTooltipProps) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const reimbursed = data.reimbursed ?? 0;
    return (
      <div className="bg-white rounded-lg shadow-md p-3 border border-gray-100 min-w-[180px]">
        <p className="font-medium text-gray-900 mb-2 truncate max-w-[200px]" title={data.category}>{data.category}</p>
        <div className="flex items-center justify-between text-sm w-full">
          <span className="text-gray-500">Net:</span>
          <span className="font-medium text-gray-900 ml-3">{money(data.absTotal)}</span>
        </div>
        {reimbursed > 0 && (
          <>
            <div className="flex items-center justify-between text-sm mt-1 w-full">
              <span className="text-gray-500">Gross:</span>
              <span className="text-gray-700 ml-3">{money(data.gross ?? data.absTotal)}</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-1 w-full">
              <span className="text-gray-500">Reimbursed:</span>
              <span className="text-emerald-700 ml-3">−{money(reimbursed)}</span>
            </div>
          </>
        )}
        <div className="flex items-center justify-between text-sm mt-1 w-full">
          <span className="text-gray-500">Share:</span>
          <span className="font-medium text-gray-900 ml-3">
            {(data.percentage * 100).toFixed(1)}%
          </span>
        </div>
      </div>
    );
  }
  return null;
};

export default function CategoryBreakdownChart({ data, onCategoryClick, total_income }: CategoryBreakdownChartProps) {
  // Sort and process data
  const categories = data?.categories || [];
  const sortedData = [...categories].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  
  const topCount = 7;
  let processed = [];
  
  if (sortedData.length > topCount) {
    const top = sortedData.slice(0, topCount);
    const other = sortedData.slice(topCount);
    const otherTotal = other.reduce((sum, item) => sum + Math.abs(item.total), 0);
    const otherGross = other.reduce((sum, item) => sum + (item.gross ?? Math.abs(item.total)), 0);
    const otherReimbursed = other.reduce((sum, item) => sum + (item.reimbursed ?? 0), 0);
    processed = [
      ...top.map(i => ({...i, absTotal: Math.abs(i.total)})), 
      { category: 'Other', total: -otherTotal, absTotal: otherTotal, gross: otherGross, reimbursed: otherReimbursed }
    ];
  } else {
    processed = sortedData.map(i => ({...i, absTotal: Math.abs(i.total)}));
  }

  // Calculate percentages
  const grandTotal = processed.reduce((sum, item) => sum + item.absTotal, 0);
  const finalData = processed.map(item => ({
    ...item,
    percentage: grandTotal > 0 ? item.absTotal / grandTotal : 0
  }));

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex-grow min-h-0 relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={finalData}
              cx="50%"
              cy="50%"
              innerRadius={73}
              outerRadius={105}
              paddingAngle={2}
              dataKey="absTotal"
              nameKey="category"
              stroke="none"
              onClick={(data: PieSectorDataItem) => onCategoryClick && onCategoryClick(String(data.name))}
              cursor={onCategoryClick ? 'pointer' : 'default'}
            >
              {finalData.map((_, index) => (
                 <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <text x="50%" y="50%" dy={-25} textAnchor="middle" dominantBaseline="middle" className="fill-gray-900 font-bold text-xs md:text-sm">
              Net Expenses
            </text>
            <text x="50%" y="50%" dy={-4} textAnchor="middle" dominantBaseline="middle" className="fill-gray-900 font-bold text-lg md:text-2xl">
              ${(data?.total_net_expenses || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </text>
            <text x="50%" y="50%" dy={16} textAnchor="middle" dominantBaseline="middle" className="fill-gray-400 text-xs">
              Gross: ${(data?.total_gross_expenses || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </text>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="pt-3 text-center text-sm text-gray-600">
        {total_income !== undefined && (
          <div>Net Income: <span className="font-semibold text-gray-900">${(total_income || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span></div>
        )}
      </div>
      <div className="pt-4 flex flex-wrap justify-center gap-x-4 gap-y-2">
        {finalData.map((entry, index) => (
          <div key={`legend-${index}`} className="flex items-center gap-1.5 text-xs sm:text-sm">
            <span 
              className="w-2.5 h-2.5 rounded-full flex-shrink-0" 
              style={{ backgroundColor: COLORS[index % COLORS.length] }} 
            />
            <span className="text-gray-600 truncate max-w-[100px]" title={entry.category}>
              {entry.category}
            </span>
          </div>
        ))}
      </div>
      {(data?.reimbursed_categories?.length ?? 0) > 0 && (
        <div className="pt-3 text-xs text-gray-500 text-center">
          <span className="font-medium text-gray-600">Covered by reimbursements: </span>
          {data.reimbursed_categories!.map((entry, index) => {
            const net = entry.net ?? 0;
            return (
              <span key={entry.category}>
                {index > 0 && ', '}
                <button type="button" onClick={() => onCategoryClick?.(entry.category)} className="hover:underline">
                  {entry.category}
                </button>
                {' '}({money(entry.gross ?? 0, 0)} spent, {money(entry.reimbursed ?? 0, 0)} back
                {net < 0 && <span className="text-emerald-700">, net {money(-net, 0)} in</span>})
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
