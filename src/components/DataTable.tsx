import { useState, useMemo, useDeferredValue } from 'react';
import { ChevronLeft, ChevronRight, FileDigit, ArrowUpDown, ChevronUp, ChevronDown, Edit2, Search, Trash2, Scissors, FilterX, Undo2, Tag } from 'lucide-react';
import type { Transaction } from '../types';

export type { Transaction } from '../types';

type SortField = 'date' | 'description' | 'category' | 'status' | 'account' | 'amount';
type SortDirection = 'asc' | 'desc';
type StatusFilter = 'all' | 'expense' | 'income' | 'reimbursement' | 'excluded' | 'included';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ITEMS_PER_PAGE = 15;
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const isCompleteISODate = (value: string): boolean => {
  if (!ISO_DATE_REGEX.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
  );
};

const statusRank = (tx: Transaction) => (tx.is_excluded ? 2 : tx.amount > 0 ? 0 : 1);

const compareRows = (a: Transaction, b: Transaction, field: SortField): number => {
  switch (field) {
    case 'amount':
      return a.amount - b.amount;
    case 'status':
      return statusRank(a) - statusRank(b);
    case 'date':
      // ISO dates compare correctly as plain strings, and much faster than a collator.
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    default:
      return collator.compare(String(a[field] ?? ''), String(b[field] ?? ''));
  }
};

const showMerchant = (tx: Transaction) =>
  !!tx.merchant && tx.merchant.trim().toLowerCase() !== tx.description?.trim().toLowerCase();

interface DataTableProps {
  data: Transaction[];
  isLoading?: boolean;
  onToggleOverride?: (id: number, status: number | null) => void;
  onEdit?: (tx: Transaction) => void;
  onSplit?: (tx: Transaction) => void;
  onUndoSplit?: (tx: Transaction) => void;
  onDelete?: (tx: Transaction) => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  extraHeaderAction?: React.ReactNode;
  /** Shows row checkboxes; the bar is rendered above the table while rows are selected. */
  renderBulkBar?: (selected: Transaction[], clearSelection: () => void) => React.ReactNode;
  emptyMessage?: React.ReactNode;
}

export default function DataTable({
  data,
  isLoading,
  onToggleOverride,
  onEdit,
  onSplit,
  onUndoSplit,
  onDelete,
  title,
  subtitle,
  extraHeaderAction,
  renderBulkBar,
  emptyMessage,
}: DataTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());

  // Typing stays snappy on big tables: the filter catches up with the latest keystroke.
  const deferredSearch = useDeferredValue(searchQuery);
  const selectable = !!renderBulkBar;

  const hasValidStartDate = startDate === '' || isCompleteISODate(startDate);
  const hasValidEndDate = endDate === '' || isCompleteISODate(endDate);
  const hasPartialStartDate = startDate !== '' && !isCompleteISODate(startDate);
  const hasPartialEndDate = endDate !== '' && !isCompleteISODate(endDate);
  const hasInvalidDateRange =
    startDate !== '' &&
    endDate !== '' &&
    isCompleteISODate(startDate) &&
    isCompleteISODate(endDate) &&
    startDate > endDate;

  const { uniqueAccounts, uniqueCategories, uniqueTags, searchIndex } = useMemo(() => {
    const accounts = new Set<string>();
    const categories = new Set<string>();
    const tags = new Set<string>();
    const index = new Map<number, string>();
    for (const tx of data) {
      if (tx.account) accounts.add(tx.account);
      if (tx.category) categories.add(tx.category);
      for (const tag of tx.tags || []) tags.add(tag);
      index.set(
        tx.id,
        [tx.description, tx.merchant, tx.category, tx.account, tx.source_file, tx.date, ...(tx.tags || [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
      );
    }
    const sorted = (set: Set<string>) => Array.from(set).sort(collator.compare);
    return { uniqueAccounts: sorted(accounts), uniqueCategories: sorted(categories), uniqueTags: sorted(tags), searchIndex: index };
  }, [data]);

  const filteredData = useMemo(() => {
    const normalizedSearch = deferredSearch.trim().toLowerCase();
    const parsedMin = minAmount.trim() === '' ? null : Number(minAmount);
    const parsedMax = maxAmount.trim() === '' ? null : Number(maxAmount);
    const applyStart = !hasInvalidDateRange && startDate && hasValidStartDate;
    const applyEnd = !hasInvalidDateRange && endDate && hasValidEndDate;

    return data.filter((tx) => {
      if (normalizedSearch && !searchIndex.get(tx.id)?.includes(normalizedSearch)) return false;

      if (accountFilter !== 'all' && tx.account !== accountFilter) return false;
      if (categoryFilter !== 'all' && tx.category !== categoryFilter) return false;
      if (tagFilter !== 'all' && !(tx.tags || []).includes(tagFilter)) return false;

      if (applyStart && tx.date < startDate) return false;
      if (applyEnd && tx.date > endDate) return false;

      const absAmount = Math.abs(tx.amount);
      if (parsedMin !== null && !Number.isNaN(parsedMin) && absAmount < parsedMin) return false;
      if (parsedMax !== null && !Number.isNaN(parsedMax) && absAmount > parsedMax) return false;

      if (statusFilter !== 'all') {
        const isIncomeCategory = tx.category?.toLowerCase() === 'income';
        const isExcluded = !!tx.is_excluded;
        if (statusFilter === 'expense' && !(tx.amount < 0)) return false;
        if (statusFilter === 'income' && !(tx.amount > 0 && isIncomeCategory)) return false;
        if (statusFilter === 'reimbursement' && !(tx.amount > 0 && !isIncomeCategory)) return false;
        if (statusFilter === 'excluded' && !isExcluded) return false;
        if (statusFilter === 'included' && isExcluded) return false;
      }

      return true;
    });
  }, [data, searchIndex, deferredSearch, statusFilter, accountFilter, categoryFilter, tagFilter, startDate, endDate, minAmount, maxAmount, hasInvalidDateRange, hasValidStartDate, hasValidEndDate]);

  const sortedData = useMemo(() => {
    const direction = sortDirection === 'asc' ? 1 : -1;
    return [...filteredData].sort((a, b) => compareRows(a, b, sortField) * direction);
  }, [filteredData, sortField, sortDirection]);

  const selectedRows = useMemo(
    () => (selectedIds.size === 0 ? [] : data.filter((tx) => selectedIds.has(tx.id))),
    [data, selectedIds],
  );

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    statusFilter !== 'all' ||
    accountFilter !== 'all' ||
    categoryFilter !== 'all' ||
    tagFilter !== 'all' ||
    (startDate !== '' && hasValidStartDate) ||
    (endDate !== '' && hasValidEndDate) ||
    minAmount.trim() !== '' ||
    maxAmount.trim() !== '';

  // Every filter change starts from page 1; done here rather than in an effect.
  const filterSetter = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setAccountFilter('all');
    setCategoryFilter('all');
    setTagFilter('all');
    setStartDate('');
    setEndDate('');
    setMinAmount('');
    setMaxAmount('');
    setCurrentPage(1);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const totalPages = Math.max(Math.ceil(sortedData.length / ITEMS_PER_PAGE), 1);
  // Derived instead of corrected in an effect, so the page never points past the end.
  const page = Math.min(currentPage, totalPages);
  const startIndex = (page - 1) * ITEMS_PER_PAGE;
  const currentData = sortedData.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const pageIds = currentData.map((tx) => tx.id);
  const selectedOnPage = pageIds.filter((id) => selectedIds.has(id)).length;
  const allOnPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length;

  const toggleRow = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const selectAllFiltered = () => setSelectedIds(new Set(sortedData.map((tx) => tx.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 text-gray-300 group-hover:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity ml-1" />;
    return sortDirection === 'asc'
      ? <ChevronUp className="h-3 w-3 text-primary-500 ml-1" />
      : <ChevronDown className="h-3 w-3 text-primary-500 ml-1" />;
  };

  // A render helper rather than a nested component, so React doesn't remount the header cells on every render.
  const renderHeaderCell = ({ field, label, align = 'left', className = '' }: { field: SortField, label: string, align?: 'left' | 'right', className?: string }) => (
    <th
      key={field}
      scope="col"
      onClick={() => handleSort(field)}
      aria-sort={sortField === field ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
      className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer group hover:bg-gray-100/50 transition-colors ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
    >
      <div className={`flex items-center ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
        {label}
        {renderSortIcon(field)}
      </div>
    </th>
  );

  const renderStatusBadge = (tx: Transaction) => {
    if (tx.is_excluded) {
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600 border border-gray-200">Excluded</span>;
    }
    if (tx.amount > 0) {
      return tx.category?.toLowerCase() === 'income'
        ? <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">Income</span>
        : <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">Reimbursement</span>;
    }
    if (tx.amount < 0) {
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200">Expense</span>;
    }
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-50 text-gray-700 border border-gray-200">Included</span>;
  };

  const renderCategoryChips = (tx: Transaction) => (
    <>
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${tx.is_excluded ? 'bg-gray-200 text-gray-500' : 'bg-gray-100 text-gray-800'} border border-gray-200 group-hover:bg-white transition-colors`}>
        {tx.category}
      </span>
      {tx.is_split && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
          Split
        </span>
      )}
    </>
  );

  const renderTags = (tx: Transaction) => (tx.tags && tx.tags.length > 0 ? (
    <div className="flex flex-wrap gap-1 mt-1">
      {tx.tags.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={() => filterSetter(setTagFilter)(tag)}
          title={`Show only #${tag}`}
          className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded text-[10px] font-medium bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100"
        >
          <Tag className="h-2.5 w-2.5" />{tag}
        </button>
      ))}
    </div>
  ) : null);

  const renderActions = (tx: Transaction, alwaysVisible = false) => (
    <div className={`flex flex-wrap items-center gap-1 ${alwaysVisible ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity'}`}>
      {onEdit && !tx.is_split && (
        <button
          onClick={() => onEdit(tx)}
          className="text-gray-400 hover:text-indigo-600 bg-white hover:bg-indigo-50 border border-gray-200 hover:border-indigo-200 rounded p-1 transition-colors"
          title="Edit Transaction"
          aria-label="Edit transaction"
        >
          <Edit2 className={alwaysVisible ? 'h-4 w-4' : 'h-3 w-3'} />
        </button>
      )}

      {onDelete && !tx.is_split && (
        <button
          onClick={() => onDelete(tx)}
          className="text-gray-400 hover:text-red-600 bg-white hover:bg-red-50 border border-gray-200 hover:border-red-200 rounded p-1 transition-colors"
          title="Delete Transaction"
          aria-label="Delete transaction"
        >
          <Trash2 className={alwaysVisible ? 'h-4 w-4' : 'h-3 w-3'} />
        </button>
      )}

      {onSplit && !tx.is_split && (
        <button
          onClick={() => onSplit(tx)}
          className="text-gray-400 hover:text-amber-700 bg-white hover:bg-amber-50 border border-gray-200 hover:border-amber-200 rounded p-1 transition-colors"
          title="Split Transaction"
          aria-label="Split transaction"
        >
          <Scissors className={alwaysVisible ? 'h-4 w-4' : 'h-3 w-3'} />
        </button>
      )}

      {onUndoSplit && tx.is_split && (
        <button
          onClick={() => onUndoSplit(tx)}
          className="text-gray-400 hover:text-sky-700 bg-white hover:bg-sky-50 border border-gray-200 hover:border-sky-200 rounded p-1 transition-colors"
          title="Undo Split"
          aria-label="Undo split"
        >
          <Undo2 className={alwaysVisible ? 'h-4 w-4' : 'h-3 w-3'} />
        </button>
      )}

      {onToggleOverride && (
        <>
          {tx.is_excluded ? (
            <button onClick={() => onToggleOverride(tx.id, 0)} className="text-[11px] text-emerald-600 border border-emerald-200 bg-emerald-50 rounded px-1.5 py-0.5 hover:bg-emerald-100 transition-colors">Include</button>
          ) : (
            <button onClick={() => onToggleOverride(tx.id, 1)} className="text-[11px] text-gray-600 border border-gray-200 bg-gray-100 rounded px-1.5 py-0.5 hover:bg-gray-200 transition-colors">Exclude</button>
          )}

          {tx.manual_override !== null && tx.manual_override !== undefined && (
            <button onClick={() => onToggleOverride(tx.id, null)} className="text-[11px] text-blue-600 border border-blue-200 bg-blue-50 rounded px-1.5 py-0.5 hover:bg-blue-100 transition-colors">Auto</button>
          )}
        </>
      )}
    </div>
  );

  const renderAmount = (tx: Transaction) => (
    <span className={`font-medium ${tx.amount < 0 ? 'text-gray-900' : 'text-emerald-600'} ${tx.is_excluded ? 'text-gray-400 font-normal' : ''}`}>
      {tx.amount > 0 ? '+' : ''}${Math.abs(tx.amount).toFixed(2)}
    </span>
  );

  if (isLoading) {
    return (
      <div className="w-full h-64 flex items-center justify-center bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="h-8 w-8 rounded-full border-4 border-primary-100 border-t-primary-500 animate-spin"></div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="w-full flex flex-col items-center justify-center py-16 px-4 bg-white rounded-xl border border-gray-200 shadow-sm text-center">
        <div className="bg-gray-50 rounded-full p-4 mb-4">
          <FileDigit className="h-10 w-10 text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-900">No transactions found</h3>
        <p className="text-gray-500 text-sm mt-1 max-w-sm">
          {emptyMessage ?? 'Get started by importing a CSV or adding a transaction.'}
        </p>
      </div>
    );
  }

  const selectClass = 'w-full sm:w-auto px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none';

  return (
    <div className="space-y-4 w-full">
      <div className="py-2 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            {title && <h2 className="text-lg font-semibold text-gray-900">{title}</h2>}
            {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}

            {data.length > 0 && title && !subtitle && (
              <span className="text-sm font-medium text-gray-500 bg-white px-3 py-1 rounded-full border border-gray-200 shadow-sm mt-2 inline-block">
                {hasActiveFilters ? `${sortedData.length.toLocaleString()} of ` : ''}{data.length.toLocaleString()} total
              </span>
            )}
          </div>
          {extraHeaderAction && <div className="self-start">{extraHeaderAction}</div>}
        </div>

        <div className="w-full bg-white border border-gray-200 rounded-lg p-3">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <div className="relative col-span-2 sm:min-w-[240px] sm:flex-1">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-gray-400" />
              </div>
              <input
                type="search"
                className="block w-full pl-10 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors outline-none"
                placeholder="Search text, merchant, tag, account..."
                aria-label="Search transactions"
                value={searchQuery}
                onChange={(e) => filterSetter(setSearchQuery)(e.target.value)}
              />
            </div>

            <select
              className={`${selectClass} sm:min-w-[150px]`}
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => filterSetter(setStatusFilter)(e.target.value as StatusFilter)}
            >
              <option value="all">All statuses</option>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="reimbursement">Reimbursement</option>
              <option value="included">Included only</option>
              <option value="excluded">Excluded only</option>
            </select>

            <select
              className={`${selectClass} sm:min-w-[150px]`}
              aria-label="Filter by account"
              value={accountFilter}
              onChange={(e) => filterSetter(setAccountFilter)(e.target.value)}
            >
              <option value="all">All accounts</option>
              {uniqueAccounts.map((account) => (
                <option key={account} value={account}>{account}</option>
              ))}
            </select>

            <select
              className={`${selectClass} sm:min-w-[150px]`}
              aria-label="Filter by category"
              value={categoryFilter}
              onChange={(e) => filterSetter(setCategoryFilter)(e.target.value)}
            >
              <option value="all">All categories</option>
              {uniqueCategories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>

            <select
              className={`${selectClass} sm:min-w-[130px]`}
              aria-label="Filter by tag"
              value={tagFilter}
              onChange={(e) => filterSetter(setTagFilter)(e.target.value)}
              disabled={uniqueTags.length === 0 && tagFilter === 'all'}
            >
              <option value="all">{uniqueTags.length === 0 ? 'No tags yet' : 'All tags'}</option>
              {uniqueTags.map((tag) => (
                <option key={tag} value={tag}>#{tag}</option>
              ))}
              {tagFilter !== 'all' && !uniqueTags.includes(tagFilter) && <option value={tagFilter}>#{tagFilter}</option>}
            </select>

            <div className="col-span-2 grid grid-cols-2 gap-2 sm:flex sm:items-center">
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="w-full sm:w-[110px] px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder="Min $"
                aria-label="Minimum amount"
                value={minAmount}
                onChange={(e) => filterSetter(setMinAmount)(e.target.value)}
              />

              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="w-full sm:w-[110px] px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder="Max $"
                aria-label="Maximum amount"
                value={maxAmount}
                onChange={(e) => filterSetter(setMaxAmount)(e.target.value)}
              />
            </div>

            <input
              type="date"
              className={`${selectClass} min-w-0 sm:min-w-[150px]`}
              value={startDate}
              onChange={(e) => filterSetter(setStartDate)(e.target.value)}
              aria-label="Start date"
            />

            <input
              type="date"
              className={`${selectClass} min-w-0 sm:min-w-[150px]`}
              value={endDate}
              onChange={(e) => filterSetter(setEndDate)(e.target.value)}
              aria-label="End date"
            />

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-1 px-2.5 py-2 text-xs text-gray-600 border border-gray-200 rounded-md bg-white hover:bg-gray-50 transition-colors"
              >
                <FilterX className="h-3.5 w-3.5" />
                Clear filters
              </button>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-gray-500">
              Showing {filteredData.length.toLocaleString()} of {data.length.toLocaleString()} transactions
            </span>

            {(hasPartialStartDate || hasPartialEndDate || hasInvalidDateRange) && (
              <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                {hasInvalidDateRange
                  ? 'Start date must be on or before end date.'
                  : 'Enter complete dates before date filters are applied.'}
              </span>
            )}
          </div>
        </div>
      </div>

      {selectable && selectedRows.length > 0 && (
        <div className="space-y-1">
          {renderBulkBar!(selectedRows, clearSelection)}
          {selectedRows.length < sortedData.length && (
            <button onClick={selectAllFiltered} className="text-xs font-medium text-primary-700 hover:underline px-1">
              Select all {sortedData.length.toLocaleString()} matching transactions
            </button>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden transition-all hover:shadow-md w-full">
        {/* Phones: stacked cards */}
        <div className="md:hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-2 bg-gray-50/80 border-b border-gray-200">
            {selectable ? (
              <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-600">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  ref={(el) => { if (el) el.indeterminate = selectedOnPage > 0 && !allOnPageSelected; }}
                  onChange={togglePage}
                  aria-label="Select all on this page"
                  className="h-4 w-4"
                />
                Select page
              </label>
            ) : <span />}
            <select
              aria-label="Sort by"
              className="text-xs border border-gray-200 rounded-md bg-white px-2 py-1"
              value={`${sortField}:${sortDirection}`}
              onChange={(e) => {
                const [field, dir] = e.target.value.split(':') as [SortField, SortDirection];
                setSortField(field);
                setSortDirection(dir);
              }}
            >
              <option value="date:desc">Newest first</option>
              <option value="date:asc">Oldest first</option>
              <option value="amount:asc">Largest expense</option>
              <option value="amount:desc">Largest credit</option>
              <option value="description:asc">Description A-Z</option>
              <option value="category:asc">Category A-Z</option>
              <option value="account:asc">Account A-Z</option>
              <option value="status:asc">Status</option>
            </select>
          </div>
          {currentData.length === 0 && (
            <p className="px-4 py-8 text-sm text-gray-500 text-center">No transactions match the current filters.</p>
          )}
          <ul className="divide-y divide-gray-100">
            {currentData.map((tx) => (
              <li key={tx.id} className={`px-4 py-3 group ${tx.is_excluded ? 'opacity-60 bg-gray-50' : ''} ${selectedIds.has(tx.id) ? 'bg-primary-50/60' : ''}`}>
                <div className="flex items-start gap-3">
                  {selectable && (
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0"
                      checked={selectedIds.has(tx.id)}
                      onChange={() => toggleRow(tx.id)}
                      aria-label={`Select ${tx.description}`}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 break-words">{tx.description}</p>
                        {showMerchant(tx) && <p className="text-xs text-gray-500 truncate">{tx.merchant}</p>}
                      </div>
                      <span className="text-sm whitespace-nowrap">{renderAmount(tx)}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{tx.date} · {tx.account}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      {renderCategoryChips(tx)}
                      {renderStatusBadge(tx)}
                    </div>
                    {renderTags(tx)}
                    <div className="mt-2">{renderActions(tx, true)}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Tablet and up: table */}
        <div className="hidden md:block overflow-x-auto w-full">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/80">
              <tr>
                {selectable && (
                  <th scope="col" className="pl-4 pr-1 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      ref={(el) => { if (el) el.indeterminate = selectedOnPage > 0 && !allOnPageSelected; }}
                      onChange={togglePage}
                      aria-label="Select all on this page"
                      className="h-4 w-4"
                    />
                  </th>
                )}
                {renderHeaderCell({ field: "date", label: "Date", className: "w-[100px]" })}
                {renderHeaderCell({ field: "description", label: "Description", className: "w-full min-w-[150px]" })}
                {renderHeaderCell({ field: "category", label: "Category", className: "min-w-[100px]" })}
                {renderHeaderCell({ field: "status", label: "Spending Status", className: "min-w-[160px]" })}
                {renderHeaderCell({ field: "account", label: "Account", className: "min-w-[120px]" })}
                {renderHeaderCell({ field: "amount", label: "Amount", align: "right", className: "min-w-[100px]" })}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {currentData.length === 0 && (
                <tr>
                  <td colSpan={selectable ? 7 : 6} className="px-4 py-8 text-sm text-gray-500 text-center">
                    No transactions match the current filters.
                  </td>
                </tr>
              )}
              {currentData.map((tx) => (
                <tr key={tx.id} className={`hover:bg-primary-50/40 transition-colors group ${tx.is_excluded ? 'opacity-60 bg-gray-50' : ''} ${selectedIds.has(tx.id) ? 'bg-primary-50/60' : ''}`}>
                  {selectable && (
                    <td className="pl-4 pr-1 py-3 align-top">
                      <input
                        type="checkbox"
                        className="h-4 w-4 mt-0.5"
                        checked={selectedIds.has(tx.id)}
                        onChange={() => toggleRow(tx.id)}
                        aria-label={`Select ${tx.description}`}
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 align-top">{tx.date}</td>
                  <td className="px-4 py-3 text-sm max-w-[200px] lg:max-w-xs align-top">
                    <p className="font-medium text-gray-900 truncate" title={tx.description}>{tx.description}</p>
                    {showMerchant(tx) && <p className="text-xs text-gray-500 truncate" title={tx.merchant ?? ''}>{tx.merchant}</p>}
                    {renderTags(tx)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm align-top">
                    <div className="flex flex-wrap items-center gap-1.5">{renderCategoryChips(tx)}</div>
                  </td>
                  <td className="px-4 py-3 text-sm align-top">
                    <div className="flex flex-col lg:flex-row items-start lg:items-center gap-2">
                      <div>{renderStatusBadge(tx)}</div>
                      {renderActions(tx)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 max-w-[120px] truncate align-top" title={tx.account}>{tx.account}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right align-top">{renderAmount(tx)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-white px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3 border-t border-gray-100">
          <p className="text-xs sm:text-sm text-gray-500">
            <span className="sm:hidden">
              {sortedData.length > 0 ? startIndex + 1 : 0}–{Math.min(startIndex + ITEMS_PER_PAGE, sortedData.length)} of {sortedData.length.toLocaleString()}
            </span>
            <span className="hidden sm:inline">
              Showing <span className="font-semibold text-gray-900">{sortedData.length > 0 ? startIndex + 1 : 0}</span> to <span className="font-semibold text-gray-900">{Math.min(startIndex + ITEMS_PER_PAGE, sortedData.length)}</span> of <span className="font-semibold text-gray-900">{sortedData.length.toLocaleString()}</span> results
            </span>
          </p>
          <nav className="flex items-center gap-2" aria-label="Pagination">
            <span className="text-xs text-gray-500 whitespace-nowrap">Page {page} of {totalPages.toLocaleString()}</span>
            <div className="inline-flex rounded-lg shadow-sm -space-x-px">
              <button
                onClick={() => setCurrentPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="relative inline-flex items-center px-3 py-2 rounded-l-lg border border-gray-200 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <span className="sr-only">Previous</span>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="relative inline-flex items-center px-3 py-2 rounded-r-lg border border-gray-200 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <span className="sr-only">Next</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </nav>
        </div>
      </div>
    </div>
  );
}
