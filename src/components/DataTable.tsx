import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, FileDigit, ArrowUpDown, ChevronUp, ChevronDown, Edit2, Search, Trash2, Scissors, FilterX, Undo2 } from 'lucide-react';

type SortField = 'date' | 'description' | 'category' | 'status' | 'account' | 'amount';
type SortDirection = 'asc' | 'desc';
type StatusFilter = 'all' | 'expense' | 'income' | 'reimbursement' | 'excluded' | 'included';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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

interface Transaction {
  id: number;
  date: string;
  description: string;
  amount: number;
  account: string;
  category: string;
  source_file: string;
  split_parent_id?: number | null;
  is_split?: boolean;
  is_excluded?: boolean;
  manual_override?: number | null;
}

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
}

export default function DataTable({ data, isLoading, onToggleOverride, onEdit, onSplit, onUndoSplit, onDelete, title, subtitle, extraHeaderAction }: DataTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

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

  const uniqueAccounts = useMemo(
    () => Array.from(new Set(data.map((tx) => tx.account).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [data]
  );

  const uniqueCategories = useMemo(
    () => Array.from(new Set(data.map((tx) => tx.category).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [data]
  );

  const filteredData = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const parsedMin = minAmount.trim() === '' ? null : Number(minAmount);
    const parsedMax = maxAmount.trim() === '' ? null : Number(maxAmount);

    return data.filter((tx) => {
      if (normalizedSearch) {
        const haystack = [tx.description, tx.category, tx.account, tx.source_file, tx.date]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(normalizedSearch)) return false;
      }

      if (accountFilter !== 'all' && tx.account !== accountFilter) return false;
      if (categoryFilter !== 'all' && tx.category !== categoryFilter) return false;

      if (!hasInvalidDateRange) {
        if (startDate && hasValidStartDate && tx.date < startDate) return false;
        if (endDate && hasValidEndDate && tx.date > endDate) return false;
      }

      const absAmount = Math.abs(tx.amount);
      if (parsedMin !== null && !Number.isNaN(parsedMin) && absAmount < parsedMin) return false;
      if (parsedMax !== null && !Number.isNaN(parsedMax) && absAmount > parsedMax) return false;

      const isIncome = tx.amount > 0 && tx.category?.toLowerCase() === 'income';
      const isReimbursement = tx.amount > 0 && tx.category?.toLowerCase() !== 'income';
      const isExpense = tx.amount < 0;
      const isExcluded = !!tx.is_excluded;

      if (statusFilter === 'expense' && !isExpense) return false;
      if (statusFilter === 'income' && !isIncome) return false;
      if (statusFilter === 'reimbursement' && !isReimbursement) return false;
      if (statusFilter === 'excluded' && !isExcluded) return false;
      if (statusFilter === 'included' && isExcluded) return false;

      return true;
    });
  }, [data, searchQuery, statusFilter, accountFilter, categoryFilter, startDate, endDate, minAmount, maxAmount, hasInvalidDateRange, hasValidStartDate, hasValidEndDate]);

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    statusFilter !== 'all' ||
    accountFilter !== 'all' ||
    categoryFilter !== 'all' ||
    (startDate !== '' && hasValidStartDate) ||
    (endDate !== '' && hasValidEndDate) ||
    minAmount.trim() !== '' ||
    maxAmount.trim() !== '';

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setAccountFilter('all');
    setCategoryFilter('all');
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

  const sortedData = [...filteredData].sort((a, b) => {
    let valA: any = a[sortField as keyof Transaction];
    let valB: any = b[sortField as keyof Transaction];

    if (sortField === 'status') {
      valA = a.is_excluded ? 2 : (a.amount > 0 ? 0 : 1);
      valB = b.is_excluded ? 2 : (b.amount > 0 ? 0 : 1);
    }

    if (valA === valB) return 0;

    if (typeof valA === 'string' && typeof valB === 'string') {
      return sortDirection === 'asc'
        ? valA.localeCompare(valB)
        : valB.localeCompare(valA);
    }

    if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(sortedData.length / itemsPerPage);
  const effectiveTotalPages = Math.max(totalPages, 1);

  // Adjust current page if it exceeds total pages after filtering
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  // Reset to page 1 whenever filter inputs change.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, accountFilter, categoryFilter, startDate, endDate, minAmount, maxAmount]);

  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentData = sortedData.slice(startIndex, startIndex + itemsPerPage);

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 text-gray-300 group-hover:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity ml-1" />;
    return sortDirection === 'asc'
      ? <ChevronUp className="h-3 w-3 text-primary-500 ml-1" />
      : <ChevronDown className="h-3 w-3 text-primary-500 ml-1" />;
  };

  const HeaderCell = ({ field, label, align = 'left', className = '' }: { field: SortField, label: string, align?: 'left' | 'right', className?: string }) => (
    <th
      scope="col"
      onClick={() => handleSort(field)}
      className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer group hover:bg-gray-100/50 transition-colors ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
    >
      <div className={`flex items-center ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
        {label}
        {renderSortIcon(field)}
      </div>
    </th>
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
          Get started by loading a local .sqlite file from the top right corner.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full">
      <div className="py-2 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            {title && <h2 className="text-lg font-semibold text-gray-900">{title}</h2>}
            {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}

            {!isLoading && data.length > 0 && title && !subtitle && (
              <span className="text-sm font-medium text-gray-500 bg-white px-3 py-1 rounded-full border border-gray-200 shadow-sm mt-2 inline-block">
                {hasActiveFilters ? `${sortedData.length} of ` : ''}{data.length} total
              </span>
            )}
          </div>
          {extraHeaderAction && <div className="self-start">{extraHeaderAction}</div>}
        </div>

        {!isLoading && data.length > 0 && (
          <div className="w-full bg-white border border-gray-200 rounded-lg p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[240px] flex-1">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="h-4 w-4 text-gray-400" />
                </div>
                <input
                  type="text"
                  className="block w-full pl-10 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors outline-none"
                  placeholder="Search text, account, category, date, source..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <select
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-w-[160px]"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              >
                <option value="all">All statuses</option>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="reimbursement">Reimbursement</option>
                <option value="included">Included only</option>
                <option value="excluded">Excluded only</option>
              </select>

              <select
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-w-[170px]"
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value)}
              >
                <option value="all">All accounts</option>
                {uniqueAccounts.map((account) => (
                  <option key={account} value={account}>{account}</option>
                ))}
              </select>

              <select
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-w-[170px]"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="all">All categories</option>
                {uniqueCategories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>

              <div className="flex items-center gap-2 min-w-[232px]">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-[110px] px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  placeholder="Min $"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                />

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-[110px] px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  placeholder="Max $"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                />
              </div>

              <input
                type="date"
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-w-[160px]"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-label="Start date"
              />

              <input
                type="date"
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-w-[160px]"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                aria-label="End date"
              />

              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1 px-2.5 py-2 text-xs text-gray-600 border border-gray-200 rounded-md bg-white hover:bg-gray-50 transition-colors"
                >
                  <FilterX className="h-3.5 w-3.5" />
                  Clear
                </button>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-gray-500">
                Showing {filteredData.length} of {data.length} transactions
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
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden transition-all hover:shadow-md w-full">
        <div className="overflow-x-auto w-full">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/80">
              <tr>
                <HeaderCell field="date" label="Date" className="w-[100px]" />
                <HeaderCell field="description" label="Description" className="w-full min-w-[150px]" />
                <HeaderCell field="category" label="Category" className="min-w-[100px]" />
                <HeaderCell field="status" label="Spending Status" className="min-w-[160px]" />
                <HeaderCell field="account" label="Account" className="min-w-[120px]" />
                <HeaderCell field="amount" label="Amount" align="right" className="min-w-[100px]" />
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {currentData.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-sm text-gray-500 text-center">
                    No transactions match the current filters.
                  </td>
                </tr>
              )}
              {currentData.map((tx) => (
                <tr key={tx.id} className={`hover:bg-primary-50/40 transition-colors group ${tx.is_excluded ? 'opacity-60 bg-gray-50' : ''}`}>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{tx.date}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 max-w-[150px] sm:max-w-[200px] md:max-w-xs truncate" title={tx.description}>
                    {tx.description}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${tx.is_excluded ? 'bg-gray-200 text-gray-500' : 'bg-gray-100 text-gray-800'} border border-gray-200 group-hover:bg-white transition-colors`}>
                        {tx.category}
                      </span>
                      {tx.is_split && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                          Split
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm flex flex-col sm:flex-row items-start sm:items-center gap-2">
                    <div>
                      {tx.is_excluded ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
                          Excluded
                        </span>
                      ) : tx.amount > 0 ? (
                        tx.category?.toLowerCase() === 'income' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Income
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                            Reimbursement
                          </span>
                        )
                      ) : tx.amount < 0 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200">
                          Expense
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-50 text-gray-700 border border-gray-200">
                          Included
                        </span>
                      )}
                    </div>

                    {!isLoading && (
                      <div className="flex flex-wrap items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {onEdit && (
                          <button
                            onClick={() => onEdit(tx)}
                            className="text-gray-400 hover:text-indigo-600 bg-white hover:bg-indigo-50 border border-gray-200 hover:border-indigo-200 rounded p-1 transition-colors"
                            title="Edit Transaction"
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>
                        )}

                        {onDelete && (
                          <button
                            onClick={() => onDelete(tx)}
                            className="text-gray-400 hover:text-red-600 bg-white hover:bg-red-50 border border-gray-200 hover:border-red-200 rounded p-1 transition-colors"
                            title="Delete Transaction"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}

                        {onSplit && !tx.is_split && (
                          <button
                            onClick={() => onSplit(tx)}
                            className="text-gray-400 hover:text-amber-700 bg-white hover:bg-amber-50 border border-gray-200 hover:border-amber-200 rounded p-1 transition-colors"
                            title="Split Transaction"
                          >
                            <Scissors className="h-3 w-3" />
                          </button>
                        )}

                        {onUndoSplit && tx.is_split && (
                          <button
                            onClick={() => onUndoSplit(tx)}
                            className="text-gray-400 hover:text-sky-700 bg-white hover:bg-sky-50 border border-gray-200 hover:border-sky-200 rounded p-1 transition-colors"
                            title="Undo Split"
                          >
                            <Undo2 className="h-3 w-3" />
                          </button>
                        )}

                        {onToggleOverride && (
                          <>
                            {tx.is_excluded ? (
                              <button onClick={() => onToggleOverride(tx.id, 0)} className="text-[10px] text-emerald-600 border border-emerald-200 bg-emerald-50 rounded px-1.5 py-0.5 hover:bg-emerald-100 transition-colors">Include</button>
                            ) : (
                              <button onClick={() => onToggleOverride(tx.id, 1)} className="text-[10px] text-gray-600 border border-gray-200 bg-gray-100 rounded px-1.5 py-0.5 hover:bg-gray-200 transition-colors">Exclude</button>
                            )}

                            {tx.manual_override !== null && tx.manual_override !== undefined && (
                              <button onClick={() => onToggleOverride(tx.id, null)} className="text-[10px] text-blue-600 border border-blue-200 bg-blue-50 rounded px-1.5 py-0.5 hover:bg-blue-100 transition-colors">Auto</button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 max-w-[100px] truncate" title={tx.account}>{tx.account}</td>
                  <td className={`px-4 py-3 whitespace-nowrap text-sm text-right font-medium ${tx.amount < 0 ? 'text-gray-900' : 'text-emerald-600'} ${tx.is_excluded ? 'text-gray-400 font-normal' : ''}`}>
                    {tx.amount > 0 ? '+' : ''}${Math.abs(tx.amount).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-white px-6 py-4 flex items-center justify-between border-t border-gray-100">
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-500">
                Showing <span className="font-semibold text-gray-900">{sortedData.length > 0 ? startIndex + 1 : 0}</span> to <span className="font-semibold text-gray-900">{Math.min(startIndex + itemsPerPage, sortedData.length)}</span> of <span className="font-semibold text-gray-900">{sortedData.length}</span> results
              </p>
            </div>
            <div>
              <nav className="relative z-0 inline-flex rounded-lg shadow-sm -space-x-px" aria-label="Pagination">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="relative inline-flex items-center px-3 py-2 rounded-l-lg border border-gray-200 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <span className="sr-only">Previous</span>
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.min(effectiveTotalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="relative inline-flex items-center px-3 py-2 rounded-r-lg border border-gray-200 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <span className="sr-only">Next</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </nav>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
