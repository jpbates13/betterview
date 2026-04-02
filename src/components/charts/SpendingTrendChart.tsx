import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

type TrendData = {
  month: string; // YYYY-MM
  total_income: number;
  reimbursed_amount: number;
  gross_expenses: number;
  net_expenses: number;
};

const CustomTooltip = ({ active, payload, label, hiddenBars = {} }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white rounded-lg shadow-md p-4 border border-gray-100">
        <p className="font-medium text-gray-900 mb-2">{label}</p>
        <div className="space-y-1.5">
          {!hiddenBars.total_income && (
            <div className="flex items-center gap-2 text-sm justify-between w-full min-w-[160px]">
               <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#10B981]" />
                <span className="text-gray-500">Income:</span>
              </div>
              <span className="font-medium text-gray-900">
                ${data.total_income.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {(!hiddenBars.total_income && (!hiddenBars.reimbursed_amount || !hiddenBars.net_expenses)) && (
            <div className="border-t border-gray-100 my-2" />
          )}

          <div className="flex items-center gap-2 text-sm justify-between w-full min-w-[160px]">
            <span className="text-gray-500 font-medium">Gross Expenses:</span>
            <span className="font-medium text-gray-900">
              ${data.gross_expenses.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          
          {!hiddenBars.reimbursed_amount && (
            <div className="flex items-center gap-2 text-sm justify-between w-full min-w-[160px]">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#93C5FD]" />
                <span className="text-gray-500">Reimbursed:</span>
              </div>
              <span className="font-medium text-emerald-600">
                -${data.reimbursed_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {!hiddenBars.net_expenses && (
            <div className="flex items-center gap-2 text-sm justify-between w-full min-w-[160px]">
               <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#64748B]" />
                <span className="text-gray-500 font-bold">Net Expenses:</span>
              </div>
              <span className="font-bold text-gray-900">
                ${data.net_expenses.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}

        </div>
      </div>
    );
  }
  return null;
};

export default function SpendingTrendChart({ data, onBarClick }: { data: TrendData[], onBarClick?: (month: string) => void }) {
  const [hiddenBars, setHiddenBars] = useState<Record<string, boolean>>({});

  const handleLegendClick = (e: any) => {
    const dataKey = e.dataKey;
    setHiddenBars(prev => ({
      ...prev,
      [dataKey]: !prev[dataKey]
    }));
  };

  // optionally format month labels: "2023-10" to "Oct '23"
  const formattedData = data.map(d => {
    const [year, month] = d.month.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return {
      ...d,
      displayMonth: date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    };
  });

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={formattedData}
        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
        <XAxis 
          dataKey="displayMonth" 
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#6B7280', fontSize: 12 }}
          dy={10}
        />
        <YAxis 
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#6B7280', fontSize: 12 }}
          tickFormatter={(val) => `$${val.toLocaleString()}`}
          width={80}
        />
        <Tooltip content={<CustomTooltip hiddenBars={hiddenBars} />} cursor={{ fill: '#F3F4F6', opacity: 0.6 }} />
        <Legend 
          wrapperStyle={{ paddingTop: '20px' }} 
          iconType="circle" 
          onClick={handleLegendClick}
          cursor="pointer"
        />
        <Bar dataKey="total_income" name="Income" hide={hiddenBars.total_income} fill="#10B981" radius={[4, 4, 0, 0]} barSize={28} onClick={(data: any) => onBarClick && onBarClick(data.payload.month)} cursor={onBarClick ? 'pointer' : 'default'} />
        <Bar dataKey="net_expenses" name="Net Expenses" hide={hiddenBars.net_expenses} stackId="expenses" fill="#64748B" barSize={28} onClick={(data: any) => onBarClick && onBarClick(data.payload.month)} cursor={onBarClick ? 'pointer' : 'default'} />
        <Bar dataKey="reimbursed_amount" name="Reimbursements" hide={hiddenBars.reimbursed_amount} stackId="expenses" fill="#93C5FD" radius={[4, 4, 0, 0]} barSize={28} onClick={(data: any) => onBarClick && onBarClick(data.payload.month)} cursor={onBarClick ? 'pointer' : 'default'} />
      </BarChart>
    </ResponsiveContainer>
  );
}
