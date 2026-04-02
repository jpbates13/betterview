import { useState, useEffect, useRef, useMemo } from 'react';
import { subMonths, startOfYear, endOfYear, format, parseISO, lastDayOfMonth, subYears, differenceInDays, subDays, addDays, startOfMonth } from 'date-fns';
import SpendingTrendChart from '../components/charts/SpendingTrendChart';
import CategoryBreakdownChart from '../components/charts/CategoryBreakdownChart';
import DataTable from '../components/DataTable';
import TransactionModal from '../components/TransactionModal';
import SplitTransactionModal from '../components/SplitTransactionModal';
import { Maximize2, Minimize2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import SpendPacingChart from '../components/charts/SpendPacingChart';
import LifestyleInflationDial from '../components/charts/LifestyleInflationDial';
import { useDatabase } from '../DatabaseContext.jsx';
import {
  bootstrapSchema,
  deleteTransaction,
  getDailySpending,
  getSpendingByCategory,
  getSpendingTrend,
  getTransactions,
  overrideTransaction,
  splitTransaction,
  undoSplitTransaction,
  updateTransaction,
} from '../dbQueries.js';

type FilterOption = 'Month to Date' | 'Last 3 Months' | 'Year to Date' | 'All Time' | 'Custom';

type PacingTopTransaction = {
  id: number;
  date: string;
  description: string;
  category: string;
  account: string;
  amount: number;
  spend_impact: number;
};

const REIMBURSEMENT_EXCLUDE_CATEGORIES = new Set(['income', 'transfers', 'transfer', 'credit card payment']);

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MIN_ALLOWED_CUSTOM_DATE = parseISO('2000-01-01');
const MAX_ALLOWED_CUSTOM_DATE = parseISO('2100-12-31');
const MAX_ALLOWED_CUSTOM_RANGE_DAYS = 3660; // ~10 years; prevents accidental huge loops during date edits.

const isCompleteISODate = (value: string): boolean => {
  if (!ISO_DATE_REGEX.test(value)) return false;
  const parsed = parseISO(value);
  return !Number.isNaN(parsed.getTime()) && format(parsed, 'yyyy-MM-dd') === value;
};

const buildTopTransactionMapByDate = (transactions: any[]): Map<string, PacingTopTransaction> => {
  const byDate = new Map<string, PacingTopTransaction>();

  transactions.forEach((tx) => {
    if (tx?.is_excluded) return;

    const amount = Number(tx.amount);
    if (!Number.isFinite(amount)) return;

    const category = String(tx.category || '').toLowerCase();
    const spendImpact = amount < 0
      ? Math.abs(amount)
      : (amount > 0 && !REIMBURSEMENT_EXCLUDE_CATEGORIES.has(category) ? -amount : 0);

    if (spendImpact <= 0 || !tx.date) return;

    const candidate: PacingTopTransaction = {
      id: tx.id,
      date: tx.date,
      description: tx.description,
      category: tx.category,
      account: tx.account,
      amount,
      spend_impact: spendImpact,
    };

    const existing = byDate.get(tx.date);
    if (!existing || candidate.spend_impact > existing.spend_impact) {
      byDate.set(tx.date, candidate);
    }
  });

  return byDate;
};

export default function Analytics() {
  const { db, isReady, dbName, dataVersion } = useDatabase() as any;

  const [filter, setFilter] = useState<FilterOption>('Month to Date');
  const [showSpikeMarkers, setShowSpikeMarkers] = useState(false);
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [trendData, setTrendData] = useState<any[]>([]);
  const [categoryData, setCategoryData] = useState<any>({ categories: [], total_gross_expenses: 0, total_net_expenses: 0 });
  const [totalIncomeAmount, setTotalIncomeAmount] = useState(0);
  const [pacingData, setPacingData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [comparisonMode, setComparisonMode] = useState<'previous-period' | 'previous-year'>('previous-period');

  // Expanded chart state
  const [expandedChart, setExpandedChart] = useState<'trend' | 'category' | 'spend-pacing' | null>(null);

  // Drilldown state
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [monthTransactions, setMonthTransactions] = useState<any[]>([]);
  const [isLoadingMonth, setIsLoadingMonth] = useState(false);
  const drilldownRef = useRef<HTMLDivElement>(null);

  // Category Drilldown state
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categoryTransactions, setCategoryTransactions] = useState<any[]>([]);
  const [isLoadingCategory, setIsLoadingCategory] = useState(false);
  const categoryDrilldownRef = useRef<HTMLDivElement>(null);

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<any | null>(null);
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);
  const [splitTx, setSplitTx] = useState<any | null>(null);

  const isValidCustomRange = useMemo(() => {
    if (!isCompleteISODate(customStartDate) || !isCompleteISODate(customEndDate)) {
      return false;
    }

    const start = parseISO(customStartDate);
    const end = parseISO(customEndDate);

    if (start < MIN_ALLOWED_CUSTOM_DATE || end > MAX_ALLOWED_CUSTOM_DATE) {
      return false;
    }

    if (start > end) {
      return false;
    }

    if (differenceInDays(end, start) > MAX_ALLOWED_CUSTOM_RANGE_DAYS) {
      return false;
    }

    return true;
  }, [customStartDate, customEndDate]);

  useEffect(() => {
    if (!isReady || !db) {
      setTrendData([]);
      setCategoryData({ categories: [], total_gross_expenses: 0, total_net_expenses: 0 });
      setPacingData([]);
      setIsLoading(false);
      return;
    }

    let startDate = '';
    let endDate = '';
    const today = new Date();

    if (filter === 'Month to Date') {
      startDate = format(startOfMonth(today), 'yyyy-MM-dd');
      endDate = format(today, 'yyyy-MM-dd');
    } else if (filter === 'Last 3 Months') {
      startDate = format(subMonths(today, 3), 'yyyy-MM-dd');
      endDate = format(today, 'yyyy-MM-dd');
    } else if (filter === 'Year to Date') {
      startDate = format(startOfYear(today), 'yyyy-MM-dd');
      endDate = format(today, 'yyyy-MM-dd');
    } else if (filter === 'Custom') {
      if (!isValidCustomRange) return;
      startDate = customStartDate;
      endDate = customEndDate;
    }

    const fetchData = async () => {
      setIsLoading(true);
      try {
        await bootstrapSchema(db);

        let prevStartDate = '';
        let prevEndDate = '';
        if (comparisonMode === 'previous-year') {
          // Compare to same timeframe in previous year
          if (filter === 'Month to Date' && startDate && endDate) {
            const start = parseISO(startDate);
            const end = parseISO(endDate);
            prevStartDate = format(subYears(start, 1), 'yyyy-MM-dd');
            prevEndDate = format(subYears(end, 1), 'yyyy-MM-dd');
          } else if (filter === 'Last 3 Months' && startDate && endDate) {
            const start = parseISO(startDate);
            const end = parseISO(endDate);
            prevStartDate = format(subYears(start, 1), 'yyyy-MM-dd');
            prevEndDate = format(subYears(end, 1), 'yyyy-MM-dd');
          } else if (filter === 'Year to Date' && startDate && endDate) {
            const start = parseISO(startDate);
            prevStartDate = format(subYears(start, 1), 'yyyy-MM-dd');
            prevEndDate = format(endOfYear(subYears(start, 1)), 'yyyy-MM-dd');
          } else if (filter === 'Custom' && startDate && endDate) {
            const start = parseISO(startDate);
            const end = parseISO(endDate);
            prevStartDate = format(subYears(start, 1), 'yyyy-MM-dd');
            prevEndDate = format(subYears(end, 1), 'yyyy-MM-dd');
          }
        } else {
          // Previous period (original logic)
          if (filter === 'Month to Date' && startDate) {
            const start = parseISO(startDate);
            const dayIndex = Math.max(0, differenceInDays(today, start));
            const prevMonthStart = startOfMonth(subMonths(start, 1));
            prevStartDate = format(prevMonthStart, 'yyyy-MM-dd');
            prevEndDate = format(addDays(prevMonthStart, dayIndex), 'yyyy-MM-dd');
          } else if (filter === 'Last 3 Months') {
            const start = parseISO(startDate);
            prevEndDate = format(subDays(start, 1), 'yyyy-MM-dd');
            prevStartDate = format(subMonths(parseISO(prevEndDate), 3), 'yyyy-MM-dd');
          } else if (filter === 'Year to Date') {
            const start = parseISO(startDate);
            prevStartDate = format(subYears(start, 1), 'yyyy-MM-dd');
            prevEndDate = format(endOfYear(subYears(start, 1)), 'yyyy-MM-dd');
          } else if (filter === 'Custom' && startDate && endDate) {
            const diff = differenceInDays(parseISO(endDate), parseISO(startDate));
            prevEndDate = format(subDays(parseISO(startDate), 1), 'yyyy-MM-dd');
            prevStartDate = format(subDays(parseISO(prevEndDate), diff), 'yyyy-MM-dd');
          }
        }

        const [
          trendRows,
          categoryRows,
          currDaily,
          prevDaily,
          currTransactions,
          prevTransactions,
        ] = await Promise.all([
          getSpendingTrend(db, { startDate: startDate || undefined, endDate: endDate || undefined }),
          getSpendingByCategory(db, { startDate: startDate || undefined, endDate: endDate || undefined }),
          getDailySpending(db, { startDate: startDate || undefined, endDate: endDate || undefined }),
          prevStartDate && prevEndDate
            ? getDailySpending(db, { startDate: prevStartDate, endDate: prevEndDate })
            : Promise.resolve([]),
          getTransactions(db, { startDate: startDate || undefined, endDate: endDate || undefined } as any),
          prevStartDate && prevEndDate
            ? getTransactions(db, { startDate: prevStartDate, endDate: prevEndDate } as any)
            : Promise.resolve([]),
        ]);

        setTrendData(trendRows);
        setCategoryData(categoryRows);

        // Calculate total income from trend data
        const totalIncome = (trendRows || []).reduce((sum: number, month: any) => sum + (month.total_income || 0), 0);
        setTotalIncomeAmount(totalIncome);

        // Process pacing data
        const currTopTxByDate = buildTopTransactionMapByDate(currTransactions || []);
        const prevTopTxByDate = buildTopTransactionMapByDate(prevTransactions || []);

        if (filter === 'All Time') {
          const allTimeData = [];
          let currSpendSum = 0;
          let currIncomeSum = 0;
          for (let i = 0; i < currDaily.length; i++) {
            currSpendSum += currDaily[i].net_expenses;
            currIncomeSum += currDaily[i].total_income;
            allTimeData.push({
              day: i + 1,
              current_date: currDaily[i].date,
              current_day_spend: Number(currDaily[i].net_expenses),
              current_day_income: Number(currDaily[i].total_income),
              current_top_transaction: currTopTxByDate.get(currDaily[i].date),
              current_spend: currSpendSum,
              current_income: currIncomeSum,
            });
          }
          setPacingData(allTimeData);
        } else {
          const daysInCurr = startDate ? differenceInDays(parseISO(endDate || format(today, 'yyyy-MM-dd')), parseISO(startDate)) + 1 : 0;
          const daysInPrev = prevStartDate ? differenceInDays(parseISO(prevEndDate), parseISO(prevStartDate)) + 1 : 0;
          const maxDays = Math.max(daysInCurr, daysInPrev);

          let currSpendSum = 0;
          let prevSpendSum = 0;
          let currIncomeSum = 0;
          let prevIncomeSum = 0;

          const currSpendMap = new Map<string, number>(currDaily.map((d: any) => [d.date, Number(d.net_expenses)]));
          const prevSpendMap = new Map<string, number>(prevDaily.map((d: any) => [d.date, Number(d.net_expenses)]));
          const currIncomeMap = new Map<string, number>(currDaily.map((d: any) => [d.date, Number(d.total_income)]));
          const prevIncomeMap = new Map<string, number>(prevDaily.map((d: any) => [d.date, Number(d.total_income)]));

          const pData = [];
          for (let i = 0; i < maxDays; i++) {
            const currDDate = startDate ? format(addDays(parseISO(startDate), i), 'yyyy-MM-dd') : null;
            const prevDDate = prevStartDate ? format(addDays(parseISO(prevStartDate), i), 'yyyy-MM-dd') : null;

            let currSpendVal;
            let currIncomeVal;
            if (currDDate && parseISO(currDDate) <= today && i < daysInCurr) {
              currSpendSum += (currSpendMap.get(currDDate) || 0);
              currIncomeSum += (currIncomeMap.get(currDDate) || 0);
              currSpendVal = currSpendSum;
              currIncomeVal = currIncomeSum;
            }

            let prevSpendVal;
            let prevIncomeVal;
            if (prevDDate && i < daysInPrev) {
              prevSpendSum += (prevSpendMap.get(prevDDate) || 0);
              prevIncomeSum += (prevIncomeMap.get(prevDDate) || 0);
              prevSpendVal = prevSpendSum;
              prevIncomeVal = prevIncomeSum;
            }

            pData.push({
              day: i + 1,
              current_date: currDDate,
              previous_date: prevDDate,
              current_day_spend: currDDate ? Number(currSpendMap.get(currDDate) || 0) : 0,
              previous_day_spend: prevDDate ? Number(prevSpendMap.get(prevDDate) || 0) : 0,
              current_day_income: currDDate ? Number(currIncomeMap.get(currDDate) || 0) : 0,
              previous_day_income: prevDDate ? Number(prevIncomeMap.get(prevDDate) || 0) : 0,
              current_top_transaction: currDDate ? currTopTxByDate.get(currDDate) : undefined,
              previous_top_transaction: prevDDate ? prevTopTxByDate.get(prevDDate) : undefined,
              current_spend: currSpendVal,
              previous_spend: prevSpendVal,
              current_income: currIncomeVal,
              previous_income: prevIncomeVal,
            });
          }
          setPacingData(pData);
        }
      } catch (err) {
        console.error('Failed to fetch analytics data:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [filter, customStartDate, customEndDate, refreshTrigger, comparisonMode, isValidCustomRange, db, isReady, dataVersion]);

  // Handle drilldown data fetching
  useEffect(() => {
    if (!selectedMonth || !db) return;

    const fetchMonthTransactions = async () => {
      setIsLoadingMonth(true);
      try {
        const [yearStr, monthStr] = selectedMonth.split('-');
        const year = parseInt(yearStr);
        const month = parseInt(monthStr) - 1; // 0-indexed for Date

        const firstDay = format(new Date(year, month, 1), 'yyyy-MM-dd');
        const lastDay = format(lastDayOfMonth(new Date(year, month, 1)), 'yyyy-MM-dd');

        const rows = await getTransactions(db, { startDate: firstDay, endDate: lastDay } as any);
        setMonthTransactions(rows);

        // Slight delay to allow DOM render before scrolling
        setTimeout(() => {
          drilldownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      } catch (err) {
        console.error('Failed to fetch month transactions for drilldown:', err);
      } finally {
        setIsLoadingMonth(false);
      }
    };

    fetchMonthTransactions();
  }, [selectedMonth, refreshTrigger, db, dataVersion]);

  // Reset drilldown when top level filters change
  useEffect(() => {
    setSelectedMonth(null);
    setSelectedCategory(null);
  }, [filter]);

  // Handle category drilldown data fetching
  useEffect(() => {
    if (!selectedCategory || !db) return;
    if (filter === 'Custom' && !isValidCustomRange) return;

    const fetchCategoryTransactions = async () => {
      setIsLoadingCategory(true);
      try {
        let categories: string[] | undefined;
        if (selectedCategory === 'Other') {
          const sortedData = [...(categoryData?.categories || [])].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
          const otherCats = sortedData.slice(7).map(d => d.category);
          if (otherCats.length > 0) {
            categories = otherCats;
          } else {
            categories = ['Other'];
          }
        } else {
          categories = [selectedCategory];
        }

        const today = new Date();
        let localStartDate: string | undefined;
        let localEndDate: string | undefined;

        if (filter === 'Month to Date') {
          localStartDate = format(startOfMonth(today), 'yyyy-MM-dd');
          localEndDate = format(today, 'yyyy-MM-dd');
        } else if (filter === 'Last 3 Months') {
          localStartDate = format(subMonths(today, 3), 'yyyy-MM-dd');
          localEndDate = format(today, 'yyyy-MM-dd');
        } else if (filter === 'Year to Date') {
          localStartDate = format(startOfYear(today), 'yyyy-MM-dd');
          localEndDate = format(today, 'yyyy-MM-dd');
        } else if (filter === 'Custom') {
          if (isValidCustomRange) {
            localStartDate = customStartDate;
            localEndDate = customEndDate;
          }
        }

        const rows = await getTransactions(db, {
          categories,
          startDate: localStartDate,
          endDate: localEndDate,
        } as any);
        setCategoryTransactions(rows);

        // Slight delay to allow DOM render before scrolling
        setTimeout(() => {
          categoryDrilldownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      } catch (err) {
        console.error('Failed to fetch category transactions for drilldown:', err);
      } finally {
        setIsLoadingCategory(false);
      }
    };

    fetchCategoryTransactions();
  }, [selectedCategory, filter, customStartDate, customEndDate, refreshTrigger, isValidCustomRange, db, dataVersion]);

  const handleToggleOverride = async (id: number, status: number | null) => {
    if (!db) return;

    try {
      await overrideTransaction(db, id, status);
      const updateFn = (prev: any[]) => prev.map((tx: any) =>
        tx.id === id ? {
          ...tx,
          manual_override: status,
          is_excluded: status === 1 ? true : status === 0 ? false : tx.is_excluded
        } : tx
      );
      if (selectedMonth) setMonthTransactions(updateFn);
      if (selectedCategory) setCategoryTransactions(updateFn);
      setRefreshTrigger(p => p + 1);
    } catch (err) {
      console.error(err);
      alert('Failed to update manual override');
    }
  };

  const openEditModal = (tx: any) => {
    setSelectedTx(tx);
    setIsModalOpen(true);
  };

  const handleUpdateTransaction = async (formData: any) => {
    try {
      if (!selectedTx) return;
      const payload = { ...selectedTx, ...formData };
      if (!db) return;
      await updateTransaction(db, selectedTx.id, payload);

      const updateFn = (prev: any[]) => prev.map((tx: any) =>
        tx.id === selectedTx.id ? { ...tx, ...formData } : tx
      );
      if (selectedMonth) setMonthTransactions(updateFn);
      if (selectedCategory) setCategoryTransactions(updateFn);
      setRefreshTrigger(p => p + 1);
    } catch (err) {
      console.error(err);
      alert('Failed to update transaction');
    }
  };

  const handleDeleteTransaction = async (tx: any) => {
    if (!db) return;

    const confirmed = window.confirm(
      `Delete this transaction?\n\n${tx.date} | ${tx.description} | $${Math.abs(tx.amount).toFixed(2)}\n\nThis action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      await deleteTransaction(db, tx.id);
      if (selectedMonth) {
        setMonthTransactions(prev => prev.filter((row: any) => row.id !== tx.id));
      }
      if (selectedCategory) {
        setCategoryTransactions(prev => prev.filter((row: any) => row.id !== tx.id));
      }
      setRefreshTrigger(p => p + 1);
    } catch (err) {
      console.error(err);
      alert('Failed to delete transaction');
    }
  };

  const openSplitModal = (tx: any) => {
    setSplitTx(tx);
    setIsSplitModalOpen(true);
  };

  const handleSplitTransaction = async (payload: { splits: Array<{ description: string; category: string; amount: number }> }) => {
    if (!db || !splitTx) return;
    try {
      await splitTransaction(db, splitTx.id, payload);
      setRefreshTrigger((p) => p + 1);
    } catch (err: any) {
      console.error(err);
      throw new Error(err?.message || 'Failed to split transaction');
    }
  };

  const handleUndoSplit = async (tx: any) => {
    if (!db) return;

    const confirmed = window.confirm(
      `Undo split for this transaction group?\n\n${tx.date} | ${tx.description} | $${Math.abs(tx.amount).toFixed(2)}\n\nThis will remove split child rows and restore the original parent transaction.`
    );
    if (!confirmed) return;

    try {
      await undoSplitTransaction(db, tx.id);
      setRefreshTrigger((p) => p + 1);
    } catch (err) {
      console.error(err);
      alert('Failed to undo split transaction');
    }
  };

  const lifestyleSignal = useMemo(() => {
    const comparablePoints = pacingData.filter(
      (point) => Number.isFinite(point.current_spend) && Number.isFinite(point.previous_spend)
    );

    if (!comparablePoints.length) {
      return {
        score: null as number | null,
        deltaPercent: null as number | null,
        deltaAmount: null as number | null,
        incomeDeltaPercent: null as number | null,
        incomeDeltaAmount: null as number | null,
        comparisonLabel: filter === 'All Time'
          ? 'Needs a comparable prior period'
          : 'Needs more comparable data',
      };
    }

    const latestPoint = comparablePoints[comparablePoints.length - 1];
    const currentSpend = Number(latestPoint.current_spend);
    const previousSpend = Number(latestPoint.previous_spend);
    const currentIncome = Number(latestPoint.current_income);
    const previousIncome = Number(latestPoint.previous_income);
    const dayLabel = latestPoint.day || comparablePoints.length;
    const deltaAmount = currentSpend - previousSpend;
    const incomeDeltaAmount = Number.isFinite(currentIncome) && Number.isFinite(previousIncome)
      ? currentIncome - previousIncome
      : null;

    let deltaPercent: number;
    if (Math.abs(previousSpend) < 0.01) {
      deltaPercent = deltaAmount === 0 ? 0 : Math.sign(deltaAmount) * 100;
    } else {
      deltaPercent = (deltaAmount / previousSpend) * 100;
    }

    let incomeDeltaPercent: number | null = null;
    if (incomeDeltaAmount !== null) {
      if (Math.abs(previousIncome) < 0.01) {
        incomeDeltaPercent = incomeDeltaAmount === 0 ? 0 : Math.sign(incomeDeltaAmount) * 100;
      } else {
        incomeDeltaPercent = (incomeDeltaAmount / previousIncome) * 100;
      }
    }

    const score = Math.max(-100, Math.min(100, deltaPercent));

    const comparisonText = comparisonMode === 'previous-year' ? 'year' : 'period';

    return {
      score,
      deltaPercent,
      deltaAmount,
      incomeDeltaPercent,
      incomeDeltaAmount,
      comparisonLabel: `Compared through day ${dayLabel} of the selected ${comparisonText}`,
    };
  }, [pacingData, filter, comparisonMode]);

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Analytics</h1>
            <p className="text-gray-500 mt-1">Visualize your spending trends and categories.</p>
            <p className="text-xs text-gray-500 mt-2">Active DB: {dbName || 'In-memory database'}</p>
          </div>

          <div className="inline-flex bg-gray-100 p-1 rounded-lg">
            {(['Month to Date', 'Last 3 Months', 'Year to Date', 'All Time', 'Custom'] as FilterOption[]).map((opt) => (
              <button
                key={opt}
                onClick={() => setFilter(opt)}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${filter === opt
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        {filter !== 'All Time' && (
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-gray-700">Compare to:</span>
            <div className="inline-flex bg-gray-100 p-1 rounded-lg gap-1">
              <button
                onClick={() => setComparisonMode('previous-period')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${comparisonMode === 'previous-period' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}
                title="Compare to the same duration in the previous period"
              >
                Previous Period
              </button>
              <button
                onClick={() => setComparisonMode('previous-year')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${comparisonMode === 'previous-year' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}
                title="Compare to the same timeframe in the previous year"
              >
                Previous Year
              </button>
            </div>
          </div>
        )}
      </div>

      {filter === 'Custom' && (
        <div className="flex flex-col sm:flex-row gap-4 items-center bg-white p-4 rounded-xl shadow-sm border border-gray-100 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <label htmlFor="startDate" className="text-sm font-medium text-gray-700">Start Date</label>
            <input
              type="date"
              id="startDate"
              value={customStartDate}
              onChange={e => setCustomStartDate(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="endDate" className="text-sm font-medium text-gray-700">End Date</label>
            <input
              type="date"
              id="endDate"
              value={customEndDate}
              onChange={e => setCustomEndDate(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
        </div>
      )}

      {/* Temporal Analysis Section - Top Priority Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 min-h-[400px] flex flex-col group relative">
          <div className="flex items-center justify-between mb-6 flex-shrink-0">
            <h2 className="text-lg font-semibold text-gray-900">Spending Trend</h2>
            <button
              onClick={() => setExpandedChart('trend')}
              className="p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              title="Expand Chart"
            >
              <Maximize2 className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-grow relative h-[300px]">
            {isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-8 w-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
              </div>
            ) : trendData.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500">No data available</div>
            ) : (
              <SpendingTrendChart data={trendData} onBarClick={setSelectedMonth} />
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 min-h-[400px] flex flex-col group relative">
          <div className="flex items-center justify-between mb-6 flex-shrink-0">
            <div className="flex items-center gap-4 flex-wrap">
              <h2 className="text-lg font-semibold text-gray-900">Spending Pacing</h2>
              <label className="inline-flex items-center gap-2 text-sm text-gray-600 select-none">
                <input
                  type="checkbox"
                  checked={showSpikeMarkers}
                  onChange={(e) => setShowSpikeMarkers(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                />
                Show leap markers
              </label>
            </div>
            <button
              onClick={() => setExpandedChart('spend-pacing')}
              className="p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              title="Expand Chart"
            >
              <Maximize2 className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-grow relative h-[300px]">
            {isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-8 w-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
              </div>
            ) : pacingData.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500">No data available</div>
            ) : (
              <SpendPacingChart data={pacingData} filter={filter} showSpikeMarkers={showSpikeMarkers} comparisonMode={comparisonMode} />
            )}
          </div>
        </div>
      </div>

      {/* Lifestyle Inflation Summary & Category Analysis - Side by Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Lifestyle Inflation Summary - Derived from Pacing Data */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <LifestyleInflationDial
            score={lifestyleSignal.score}
            deltaPercent={lifestyleSignal.deltaPercent}
            deltaAmount={lifestyleSignal.deltaAmount}
            incomeDeltaPercent={lifestyleSignal.incomeDeltaPercent}
            incomeDeltaAmount={lifestyleSignal.incomeDeltaAmount}
            comparisonLabel={lifestyleSignal.comparisonLabel}
            isLoading={isLoading}
          />
        </div>

        {/* Category Analysis Section */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 min-h-[400px] flex flex-col group relative">
          <div className="flex items-center justify-between mb-6 flex-shrink-0">
            <h2 className="text-lg font-semibold text-gray-900">Category Breakdown (Expenses)</h2>
            <button
              onClick={() => setExpandedChart('category')}
              className="p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              title="Expand Chart"
            >
              <Maximize2 className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-grow relative h-[300px]">
            {isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-8 w-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
              </div>
            ) : !categoryData?.categories?.length ? (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500">No data available</div>
            ) : (
              <CategoryBreakdownChart data={categoryData} onCategoryClick={setSelectedCategory} total_income={totalIncomeAmount} />
            )}
          </div>        </div>      </div>

      {/* Drilldown Section */}
      {selectedMonth && (
        <div ref={drilldownRef} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 animate-in fade-in slide-in-from-bottom-4 w-full overflow-x-auto">
          <DataTable
            title={
              <>Transactions for <span className="text-primary-600">{format(new Date(parseInt(selectedMonth.split('-')[0]), parseInt(selectedMonth.split('-')[1]) - 1), 'MMMM yyyy')}</span></>
            }
            subtitle="Review exactly what was included and excluded in the metrics above."
            extraHeaderAction={
              <button
                onClick={() => setSelectedMonth(null)}
                className="text-gray-500 hover:text-gray-900 transition-colors text-sm font-medium px-4 py-2 hover:bg-gray-100 rounded-lg border border-transparent hover:border-gray-200 whitespace-nowrap"
              >
                Close Breakdown
              </button>
            }
            data={monthTransactions}
            isLoading={isLoadingMonth}
            onToggleOverride={handleToggleOverride}
            onEdit={openEditModal}
            onSplit={openSplitModal}
            onUndoSplit={handleUndoSplit}
            onDelete={handleDeleteTransaction}
          />
        </div>
      )}

      {/* Category Drilldown Section */}
      {selectedCategory && (
        <div ref={categoryDrilldownRef} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 animate-in fade-in slide-in-from-bottom-4 w-full overflow-x-auto mt-8">
          <DataTable
            title={
              <>Transactions for Category: <span className="text-primary-600">{selectedCategory}</span></>
            }
            subtitle="Review specific transactions forming this category."
            extraHeaderAction={
              <button
                onClick={() => setSelectedCategory(null)}
                className="text-gray-500 hover:text-gray-900 transition-colors text-sm font-medium px-4 py-2 hover:bg-gray-100 rounded-lg border border-transparent hover:border-gray-200 whitespace-nowrap"
              >
                Close Breakdown
              </button>
            }
            data={categoryTransactions}
            isLoading={isLoadingCategory}
            onToggleOverride={handleToggleOverride}
            onEdit={openEditModal}
            onSplit={openSplitModal}
            onUndoSplit={handleUndoSplit}
            onDelete={handleDeleteTransaction}
          />
        </div>
      )}

      <TransactionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        mode="edit"
        initialData={selectedTx}
        onSubmit={handleUpdateTransaction}
      />

      <SplitTransactionModal
        isOpen={isSplitModalOpen}
        transaction={splitTx}
        onClose={() => setIsSplitModalOpen(false)}
        onSubmit={handleSplitTransaction}
      />

      {/* Expanded Chart Modal */}
      {expandedChart && document.body ? createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 sm:p-6 md:p-12 animate-in fade-in duration-300" onClick={() => setExpandedChart(null)}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full h-full max-w-7xl flex flex-col p-6 sm:p-8 animate-in zoom-in-95 slide-in-from-bottom-8 duration-500 relative"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                {expandedChart === 'trend' ? 'Spending Trend' : 'Category Breakdown'}
              </h2>
              <button
                onClick={() => setExpandedChart(null)}
                className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors focus:ring-2 focus:ring-primary-500 outline-none"
              >
                <Minimize2 className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-grow min-h-0 relative">
              {expandedChart === 'trend' && (
                <SpendingTrendChart
                  data={trendData}
                  onBarClick={(month) => {
                    setSelectedMonth(month);
                    setExpandedChart(null); // Optional: close modal when drill down
                  }}
                />
              )}
              {expandedChart === 'category' && (
                <CategoryBreakdownChart
                  data={categoryData}
                  onCategoryClick={(cat) => {
                    setSelectedCategory(cat);
                    setExpandedChart(null); // Optional: close modal when drill down
                  }}
                  total_income={totalIncomeAmount}
                />
              )}
              {expandedChart === 'spend-pacing' && (
                <SpendPacingChart
                  data={pacingData}
                  filter={filter}
                  showSpikeMarkers={showSpikeMarkers}
                  comparisonMode={comparisonMode}
                />
              )}
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
