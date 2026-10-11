// Shared domain types for the data layer (dbQueries, csvImporter, db/*) and the UI.

// ── Database handle ──────────────────────────────────────────────────────────

export type SqlValue = string | number | Uint8Array | null;

// One statement's result from sql.js `Database.exec`.
export interface QueryExecResult {
  columns: string[];
  values: SqlValue[][];
}

// Worker-backed database api exposed by DatabaseContext.
export interface DbApi {
  exec: (sql: string, params?: unknown[]) => Promise<QueryExecResult[]>;
  export: () => Promise<Uint8Array<ArrayBuffer>>;
}

export type Row = Record<string, SqlValue>;

// ── Transactions ─────────────────────────────────────────────────────────────

// A visible transaction as returned by getTransactions.
export interface Transaction {
  id: number;
  date: string;
  description: string;
  amount: number;
  account: string;
  category: string;
  source_file: string;
  manual_override: number | null;
  split_parent_id: number | null;
  merchant: string | null;
  import_batch_id: string | null;
  reimburses_id: number | null;
  applied_rule_id: number | null;
  applied_rule_name: string | null;
  tags: string[];
  is_excluded: boolean;
  is_split: boolean;
}

export interface TransactionQuery {
  startDate?: string;
  endDate?: string;
  categories?: string[];
  importBatchId?: string;
  tag?: string;
  ids?: number[];
}

// Fields createTransaction and updateTransaction read.
export interface TransactionInput {
  date: string;
  description: string;
  amount: number | string;
  account: string;
  category: string;
  source_file?: string;
  manual_override?: number | null;
}

// A row of the transactions table as the importer and rule engine build it.
export interface TransactionRecord {
  id?: number;
  date: string;
  description: string;
  amount: number;
  account: string;
  category: string;
  source_file: string;
  manual_override: number | null;
  dedupe_group_key: string;
  dedupe_source_amount: number;
  dedupe_source_date: string;
  split_parent_id: number | null;
  is_hidden?: number;
  dedupe_seq?: number;
  import_batch_id?: string | null;
  applied_rule_id?: number | null;
  merchant?: string | null;
}

export type ImportPlan =
  | { kind: 'split'; parent: TransactionRecord; children: TransactionRecord[] }
  | { kind: 'single'; transaction: TransactionRecord };

export interface MutationResult {
  status: 'success';
  id: number;
}

export interface SplitLineInput {
  description?: string;
  category: string;
  amount: number | string;
}

export interface SplitResult {
  status: 'success';
  original_id: number;
  created_ids: number[];
  deleted_original: boolean;
  hidden_original: boolean;
}

export interface UndoSplitResult {
  status: 'success';
  parent_id: number;
  deleted_split_rows: number;
}

// ── Rules ────────────────────────────────────────────────────────────────────

export type MatchType = 'all' | 'any';

export interface RuleCondition {
  column: string;
  operator: string;
  value: string;
}

// Decoded form of Rule.match_payload.
export interface MatchPayload {
  match_type: MatchType;
  conditions: RuleCondition[];
}

export type SplitLineType = 'fixed' | 'percentage' | 'remainder';

export interface RuleSplitLine {
  category: string;
  description: string;
  type: SplitLineType;
  value: number;
}

// Decoded form of Rule.action_payload for split rules.
export interface SplitConfig {
  splits: RuleSplitLine[];
}

export interface Rule {
  id: number;
  name: string;
  priority: number;
  // Legacy single-condition fields, mirrored from the first condition.
  match_column: string;
  match_operator: string;
  match_value: string;
  // JSON-encoded MatchPayload.
  match_payload: string | null;
  action_type: string;
  // Target category, or JSON-encoded SplitConfig for split rules.
  action_payload: string;
  is_active: boolean;
}

// What createRule, updateRule, previewRule and executeRuleOnDatabase accept.
export interface RuleInput {
  id?: number | null;
  name?: string;
  priority?: number | string;
  match_column?: string;
  match_operator?: string;
  match_value?: string;
  match_payload?: string | RuleCondition[] | null;
  action_type?: string;
  action_payload?: string | SplitConfig | null;
  is_active?: boolean | number;
}

export type RulePreviewRow = Omit<Transaction, 'applied_rule_name'> & { change: string };

export interface AnalyticsSettingsConfig {
  excluded_category_keywords: string[];
  excluded_description_keywords: string[];
  reimbursement_excluded_categories: string[];
}

// ── CSV import ───────────────────────────────────────────────────────────────

export type CsvRow = Record<string, string>;

export interface CsvProfile {
  id?: number;
  name: string;
  date: string | null;
  dateFormat: string;
  description: string | null;
  amount: string | null;
  debit: string | null;
  credit: string | null;
  invertAmount: boolean;
  account: string | null;
  defaultAccount: string;
  category: string | null;
  headers?: string[];
}

export interface SkippedRow {
  line: number;
  reason: string;
}

export interface ImportSummary {
  batchId: string;
  fileName: string;
  profileName: string;
  total: number;
  inserted: number;
  duplicates: number;
  categorizedByRules: number;
  splitByRules: number;
  skipped: SkippedRow[];
  insertedIds: number[];
}

export interface ImportBatch {
  id: string;
  file_name: string;
  profile_name: string | null;
  imported_at: string;
  inserted_count: number;
  duplicate_count: number;
  visible_rows: number;
}

// ── Analytics ────────────────────────────────────────────────────────────────

export interface Kpis {
  month: string;
  total_income: number;
  total_reimbursements: number;
  gross_expenses: number;
  net_expenses: number;
  net_flow: number;
}

export interface CategoryTotal {
  category: string;
  /** Net spending as a negative number, like the transactions. */
  total: number;
  gross?: number;
  reimbursed?: number;
  net?: number;
}

export interface CategoryNetSpending {
  month?: string;
  category: string;
  gross: number;
  reimbursed: number;
  net: number;
}

export interface CategorySpending {
  /** Categories with net spending, largest first. */
  categories: CategoryTotal[];
  /** Categories whose reimbursements covered all their spending or more. */
  reimbursed_categories?: CategoryTotal[];
  total_gross_expenses: number;
  total_reimbursed?: number;
  total_net_expenses: number;
}

export interface TrendPoint {
  month: string;
  total_income: number;
  reimbursed_amount: number;
  gross_expenses: number;
  net_expenses: number;
  net_flow: number;
}

export interface DailySpending {
  date: string;
  total_income: number;
  reimbursed_amount: number;
  gross_expenses: number;
  net_expenses: number;
}

export interface DateRange {
  startDate?: string;
  endDate?: string;
}

// ── Planning and features ────────────────────────────────────────────────────

export interface Budget {
  category: string;
  monthly_amount: number;
}

export interface BudgetProgress extends Budget {
  spent: number;
  remaining: number;
  percent: number;
  expectedByToday: number;
  isOver: boolean;
  isAheadOfPace: boolean;
}

export interface RecurringCharge {
  merchant: string;
  category: string;
  cadence: string;
  occurrences: number;
  typicalAmount: number;
  lastAmount: number;
  previousAmount: number;
  priceChange: number;
  firstDate: string;
  lastDate: string;
  nextExpected: string;
  isStopped: boolean;
  yearlyCost: number;
}

export interface AccountBalance {
  id: number;
  account: string;
  date: string;
  balance: number;
}

export interface NetWorthPoint {
  date: string;
  netWorth: number;
  byAccount: Record<string, number>;
}

export interface TagSummary {
  tag: string;
  count: number;
  total: number;
}

export interface YearSummary {
  year: number;
  income: number;
  grossExpenses: number;
  netSpent: number;
  savingsRate: number | null;
  categories: { category: string; spent: number }[];
  topMerchants: { merchant: string; count: number; spent: number }[];
  monthly: { month: number; spent: number }[];
}

export interface MonthlySavings {
  month: string;
  income: number;
  spent: number;
  saved: number;
  savingsRate: number | null;
}

export interface CreditRow {
  id: number;
  date: string;
  description: string;
  amount: number;
}

export interface UnlinkedCredit extends CreditRow {
  category: string | null;
}

export interface ReimbursementStatus extends CreditRow {
  category: string;
  repaid: number;
  outstanding: number;
  isSettled: boolean;
}

export interface DuplicatePair {
  a_id: number;
  a_date: string;
  a_description: string;
  a_source: string | null;
  b_id: number;
  b_date: string;
  b_description: string;
  b_source: string | null;
  amount: number;
  account: string;
}

export interface MerchantRule {
  id: number;
  pattern: string;
  merchant: string;
}

// ── Google Drive ─────────────────────────────────────────────────────────────

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
  version?: string;
  size?: string;
}
