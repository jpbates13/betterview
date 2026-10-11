import type {
  AnalyticsSettingsConfig,
  CategorySpending,
  DailySpending,
  DateRange,
  DbApi,
  ImportPlan,
  Kpis,
  MutationResult,
  Rule,
  RuleInput,
  RulePreviewRow,
  SplitLineInput,
  SplitResult,
  Transaction,
  TransactionInput,
  TransactionQuery,
  TransactionRecord,
  TrendPoint,
  UndoSplitResult,
} from './types';

export function getAnalyticsInclusionSql(db: DbApi): Promise<string>;
export function ensureDedupeIndex(db: DbApi): Promise<void>;
export function bootstrapSchema(db: DbApi): Promise<void>;

export function getTransactions(db: DbApi | null | undefined, options?: TransactionQuery): Promise<Transaction[]>;
export function createTransaction(db: DbApi, tx: TransactionInput): Promise<MutationResult>;
export function updateTransaction(db: DbApi, transactionId: number, tx: TransactionInput): Promise<MutationResult>;
export function deleteTransaction(db: DbApi, transactionId: number): Promise<MutationResult>;
export function overrideTransaction(
  db: DbApi,
  transactionId: number,
  overrideStatus: number | null,
): Promise<{ status: 'success'; override_status: number | null }>;

export function getRules(db: DbApi | null | undefined, options?: { activeOnly?: boolean }): Promise<Rule[]>;
export function getAnalyticsSettingsConfig(db: DbApi | null | undefined): Promise<AnalyticsSettingsConfig | null>;
export function updateAnalyticsSettingsConfig(
  db: DbApi | null | undefined,
  updates?: Partial<AnalyticsSettingsConfig>,
): Promise<AnalyticsSettingsConfig | null>;
export function createRule(db: DbApi, rule: RuleInput): Promise<MutationResult>;
export function updateRule(db: DbApi, ruleId: number, rule: RuleInput): Promise<MutationResult>;
export function deleteRule(db: DbApi, ruleId: number): Promise<MutationResult>;
export function applyRulesToImportedTransactions(rows: TransactionRecord[], rules?: Rule[]): ImportPlan[];
export function previewRule(db: DbApi, rule: RuleInput): Promise<RulePreviewRow[]>;
export function executeRuleOnDatabase(db: DbApi | null | undefined, rule: RuleInput): Promise<number>;

export function splitTransaction(
  db: DbApi,
  transactionId: number,
  payload: { splits?: SplitLineInput[] } | null | undefined,
): Promise<SplitResult>;
export function undoSplitTransaction(db: DbApi, transactionId: number): Promise<UndoSplitResult>;

export function getKpis(db: DbApi, month: string): Promise<Kpis>;
export function getSpendingByCategory(db: DbApi, range?: DateRange): Promise<CategorySpending>;
export function getSpendingTrend(db: DbApi, range?: DateRange): Promise<TrendPoint[]>;
export function getDailySpending(db: DbApi, range?: DateRange): Promise<DailySpending[]>;
