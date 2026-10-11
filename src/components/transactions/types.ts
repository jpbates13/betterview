// Shared shapes for the transactions UI. The data layer is plain JS, so these
// describe what getTransactions and friends return.

export interface Transaction {
  id: number;
  date: string;
  description: string;
  amount: number;
  account: string;
  category: string;
  source_file: string;
  merchant?: string | null;
  tags?: string[];
  import_batch_id?: string | null;
  reimburses_id?: number | null;
  applied_rule_id?: number | null;
  applied_rule_name?: string | null;
  split_parent_id?: number | null;
  is_split?: boolean;
  is_excluded?: boolean;
  manual_override?: number | null;
}

// Database handle exposed by DatabaseContext (a thin proxy to the SQL.js worker).
export interface DbHandle {
  exec: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  export: () => Promise<Uint8Array>;
}

export interface DatabaseContextValue {
  db: DbHandle | null;
  dbName: string;
  isReady: boolean;
  error: string;
  dataVersion: number;
  lastMutationTime: number | null;
  notifyDataChanged: () => void;
  triggerMutation: () => void;
}

export interface CsvProfile {
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

export interface ImportSummary {
  batchId: string;
  fileName: string;
  profileName: string;
  total: number;
  inserted: number;
  duplicates: number;
  categorizedByRules: number;
  splitByRules: number;
  skipped: Array<{ line: number; reason: string }>;
  insertedIds: number[];
}

export const errorMessage = (err: unknown, fallback: string): string => {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
};
