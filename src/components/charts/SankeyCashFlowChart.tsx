import { useEffect, useMemo, useRef, useState } from 'react';
import { Sankey, Tooltip } from 'recharts';

type TransactionLike = {
  amount: number;
  category?: string | null;
  is_excluded?: boolean;
};

type SankeyCashFlowChartProps = {
  transactions: TransactionLike[];
};

type SankeyNode = {
  name: string;
  fill?: string;
};

type SankeyLink = {
  source: number;
  target: number;
  value: number;
};

const TRANSFER_LABELS = new Set(['transfer', 'transfers', 'credit card payment']);
const INCOME_LABELS = new Set(['income']);

const COLORS = {
  income: '#16a34a',
  reimbursements: '#10b981',
  transferIn: '#22c55e',
  pool: '#0f172a',
  expense: '#f97316',
  transferOut: '#ea580c',
  savings: '#0ea5e9',
  gap: '#ef4444',
};

const currency = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const toTitleCase = (value: string): string => {
  return value
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const normalizeCategory = (value?: string | null): string => {
  if (!value) return 'Uncategorized';
  const cleaned = value.trim().toLowerCase();
  if (!cleaned) return 'Uncategorized';
  return cleaned;
};

const isTransferCategory = (category: string): boolean => {
  return TRANSFER_LABELS.has(category);
};

const isIncomeCategory = (category: string): boolean => {
  return INCOME_LABELS.has(category);
};

const SankeyTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const link = payload[0]?.payload;
  if (!link) return null;

  return (
    <div className="bg-white border border-gray-200 shadow-md rounded-lg px-3 py-2 text-sm">
      <div className="text-gray-500">Flow</div>
      <div className="font-semibold text-gray-900">
        {link.source?.name} to {link.target?.name}
      </div>
      <div className="text-gray-700 mt-1">{currency.format(Number(link.value || 0))}</div>
    </div>
  );
};

const SankeyNodeLabel = ({ x, y, width, height, payload, chartWidth }: any) => {
  const nodeFill = payload?.fill || '#64748b';
  const isLeftSide = x + width / 2 < chartWidth / 2;
  const labelX = isLeftSide ? x + width + 8 : x - 8;
  const labelAnchor = isLeftSide ? 'start' : 'end';
  const value = Number(payload?.value || 0);

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={nodeFill} rx={0} ry={0} />
      <text
        x={labelX}
        y={y + Math.max(10, height / 2 - 4)}
        textAnchor={labelAnchor}
        fill="#0f172a"
        fontSize={12}
        fontWeight={600}
      >
        {payload?.name}
      </text>
      <text
        x={labelX}
        y={y + Math.max(22, height / 2 + 10)}
        textAnchor={labelAnchor}
        fill="#64748b"
        fontSize={11}
      >
        {currency.format(value)}
      </text>
    </g>
  );
};

const SankeyFlowLink = ({ sourceX, sourceY, targetX, targetY, sourceControlX, targetControlX, linkWidth, payload }: any) => {
  const sourceColor = payload?.source?.fill || '#94a3b8';
  const d = `M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`;
  return (
    <path
      d={d}
      fill="none"
      stroke={sourceColor}
      strokeOpacity={0.4}
      strokeWidth={Math.max(1, linkWidth)}
      strokeLinecap="butt"
      strokeLinejoin="miter"
    />
  );
};

export default function SankeyCashFlowChart({ transactions }: SankeyCashFlowChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      setSize((prev) => {
        if (prev.width === width && prev.height === height) return prev;
        return { width, height };
      });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const chartData = useMemo(() => {
    let incomeIn = 0;
    let reimbursementsIn = 0;
    let transferIn = 0;
    let transferOut = 0;
    const expenseByCategory = new Map<string, number>();

    transactions.forEach((tx) => {
      if (tx?.is_excluded) return;

      const amount = Number(tx.amount);
      if (!Number.isFinite(amount) || amount === 0) return;

      const category = normalizeCategory(tx.category);

      if (amount > 0) {
        if (isTransferCategory(category)) {
          transferIn += amount;
        } else if (isIncomeCategory(category)) {
          incomeIn += amount;
        } else {
          reimbursementsIn += amount;
        }
        return;
      }

      const outflow = Math.abs(amount);
      if (isTransferCategory(category)) {
        transferOut += outflow;
      } else {
        const current = expenseByCategory.get(category) || 0;
        expenseByCategory.set(category, current + outflow);
      }
    });

    const sortedExpenses = Array.from(expenseByCategory.entries()).sort((a, b) => b[1] - a[1]);
    const topExpenseCount = 7;
    const topExpenses = sortedExpenses.slice(0, topExpenseCount);
    const otherExpenses = sortedExpenses.slice(topExpenseCount);
    const otherExpensesTotal = otherExpenses.reduce((sum, [, value]) => sum + value, 0);

    const nodes: SankeyNode[] = [
      { name: 'Income', fill: COLORS.income },
      { name: 'Reimbursements', fill: COLORS.reimbursements },
      { name: 'Transfers In', fill: COLORS.transferIn },
      { name: 'Cash Pool', fill: COLORS.pool },
    ];
    const links: SankeyLink[] = [];

    const addNode = (name: string, fill?: string): number => {
      nodes.push({ name, fill });
      return nodes.length - 1;
    };

    if (incomeIn > 0) {
      links.push({ source: 0, target: 3, value: incomeIn });
    }
    if (reimbursementsIn > 0) {
      links.push({ source: 1, target: 3, value: reimbursementsIn });
    }
    if (transferIn > 0) {
      links.push({ source: 2, target: 3, value: transferIn });
    }

    topExpenses.forEach(([category, value]) => {
      if (value <= 0) return;
      const idx = addNode(toTitleCase(category), COLORS.expense);
      links.push({ source: 3, target: idx, value });
    });

    if (otherExpensesTotal > 0) {
      const idx = addNode('Other Expenses', COLORS.expense);
      links.push({ source: 3, target: idx, value: otherExpensesTotal });
    }

    if (transferOut > 0) {
      const idx = addNode('Transfers Out', COLORS.transferOut);
      links.push({ source: 3, target: idx, value: transferOut });
    }

    const totalIn = incomeIn + reimbursementsIn + transferIn;
    const totalOut = topExpenses.reduce((sum, [, value]) => sum + value, 0) + otherExpensesTotal + transferOut;

    if (totalIn > totalOut) {
      const idx = addNode('Net Savings', COLORS.savings);
      links.push({ source: 3, target: idx, value: totalIn - totalOut });
    } else if (totalOut > totalIn) {
      const idx = addNode('Funding Gap', COLORS.gap);
      links.push({ source: idx, target: 3, value: totalOut - totalIn });
    }

    const hasData = links.some((link) => link.value > 0);

    return {
      data: { nodes, links },
      hasData,
      summary: {
        totalIn,
        totalOut,
        net: totalIn - totalOut,
      },
    };
  }, [transactions]);

  if (!chartData.hasData) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        No cash flow data available for this range.
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      <div className="text-xs text-gray-600 mb-3 flex flex-wrap gap-4">
        <span>In: <span className="font-semibold text-gray-900">{currency.format(chartData.summary.totalIn)}</span></span>
        <span>Out: <span className="font-semibold text-gray-900">{currency.format(chartData.summary.totalOut)}</span></span>
        <span>
          Net:{' '}
          <span className={`font-semibold ${chartData.summary.net >= 0 ? 'text-sky-700' : 'text-red-700'}`}>
            {currency.format(chartData.summary.net)}
          </span>
        </span>
      </div>
      <div ref={containerRef} className="flex-1 min-h-[360px]">
        {size.width > 24 && size.height > 24 ? (
          <Sankey
            width={size.width}
            height={size.height}
            data={chartData.data}
            nodePadding={22}
            nodeWidth={14}
            margin={{ top: 8, right: size.width < 720 ? 84 : 140, bottom: 8, left: size.width < 720 ? 84 : 140 }}
            node={(nodeProps: any) => <SankeyNodeLabel {...nodeProps} chartWidth={size.width} />}
            link={(linkProps: any) => <SankeyFlowLink {...linkProps} />}
          >
            <Tooltip content={<SankeyTooltip />} />
          </Sankey>
        ) : null}
      </div>
    </div>
  );
}