import type {
  AccountBalance,
  Budget,
  BudgetProgress,
  CreditRow,
  DateRange,
  DbApi,
  DuplicatePair,
  MonthlySavings,
  NetWorthPoint,
  RecurringCharge,
  ReimbursementStatus,
  TagSummary,
  Transaction,
  YearSummary,
} from '../types';

export const normalizeTag: (tag: unknown) => string;
export function setTransactionTags(db: DbApi, transactionId: number, tags: string[] | null | undefined): Promise<string[]>;
export function addTagToTransactions(db: DbApi, transactionIds: number[], tag: string): Promise<number>;
export function removeTagFromTransactions(db: DbApi, transactionIds: number[], tag: string): Promise<void>;
export function getTagSummary(db: DbApi, range?: DateRange): Promise<TagSummary[]>;

export function bulkSetCategory(db: DbApi, transactionIds: number[], category: string): Promise<number>;
export function bulkSetOverride(db: DbApi, transactionIds: number[], overrideStatus: number | null): Promise<number>;
export function bulkDelete(db: DbApi, transactionIds: number[]): Promise<number>;

export const REIMBURSABLE_TAG: 'reimbursable';
export function linkReimbursement(db: DbApi, reimbursementId: number, expenseId: number | null): Promise<void>;
export function getReimbursementStatus(db: DbApi): Promise<ReimbursementStatus[]>;
export function getLinkedReimbursements(db: DbApi, expenseId: number): Promise<CreditRow[]>;
export interface LinkCandidate {
  id: number;
  date: string;
  description: string;
  amount: number;
  category: string | null;
  repaid: number;
}
export function searchLinkCandidates(
  db: DbApi,
  options: { side: 'expense' | 'credit'; query?: string; nearDate?: string; excludeId?: number | null; limit?: number },
): Promise<LinkCandidate[]>;

export function getBudgets(db: DbApi): Promise<Budget[]>;
export function setBudget(db: DbApi, category: string, monthlyAmount: number | string): Promise<void>;
export function deleteBudget(db: DbApi, category: string): Promise<void>;
export function getNetSpendingByCategory(db: DbApi, startDate: string, endDate: string): Promise<Map<string, number>>;
export function getBudgetProgress(db: DbApi, month: string, today?: string): Promise<BudgetProgress[]>;

export function detectRecurringCharges(db: DbApi, options?: { today?: string }): Promise<RecurringCharge[]>;

export function getAccountBalances(db: DbApi): Promise<AccountBalance[]>;
export function setAccountBalance(
  db: DbApi,
  snapshot: { account: string; date: string; balance: number | string },
): Promise<void>;
export function deleteAccountBalance(db: DbApi, id: number): Promise<void>;
export function getNetWorthSeries(db: DbApi, options?: { months?: number; today?: string }): Promise<NetWorthPoint[]>;

export function getYearSummary(db: DbApi, year: number): Promise<YearSummary>;
export function getMonthlySavingsRate(db: DbApi, options?: { months?: number; today?: string }): Promise<MonthlySavings[]>;
export function getCategoryNames(db: DbApi): Promise<string[]>;
export function transactionsToCsv(rows: ReadonlyArray<Pick<Transaction, 'date' | 'description' | 'merchant' | 'amount' | 'category' | 'account' | 'tags'>>): string;
export function getPossibleDuplicates(db: DbApi): Promise<DuplicatePair[]>;
export function monthBounds(month: string): { start: string; end: string; days: number };

export interface ReimbursementSuggestion {
  id: number;
  date: string;
  description: string;
  amount: number;
  category: string | null;
  repaid: number;
  reason: string;
  score: number;
}
export function suggestReimbursementLinks(
  db: DbApi,
  creditId: number,
  options?: { days?: number; limit?: number },
): Promise<ReimbursementSuggestion[]>;
