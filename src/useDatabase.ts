import { createContext, useContext } from 'react';
import type { AnalyticsSettingsConfig, DbApi, MutationResult, Rule, RuleInput } from './types';

export interface DatabaseContextValue {
  db: DbApi | null;
  dbName: string;
  isReady: boolean;
  error: string;
  dataVersion: number;
  lastMutationTime: number | null;
  loadDatabaseFile: (file: File | null | undefined) => Promise<void>;
  createEmptyDatabase: () => Promise<void>;
  exportDatabase: () => Promise<Uint8Array<ArrayBuffer>>;
  reloadDatabaseFromBrowser: () => Promise<boolean>;
  notifyDataChanged: () => void;
  triggerMutation: () => void;
  getRules: (options?: { activeOnly?: boolean }) => Promise<Rule[]>;
  createRule: (rule: RuleInput) => Promise<MutationResult>;
  updateRule: (ruleId: number, rule: RuleInput) => Promise<MutationResult>;
  deleteRule: (ruleId: number) => Promise<MutationResult>;
  executeRuleOnDatabase: (rule: RuleInput) => Promise<number>;
  getAnalyticsSettingsConfig: () => Promise<AnalyticsSettingsConfig | null>;
  updateAnalyticsSettingsConfig: (updates: Partial<AnalyticsSettingsConfig>) => Promise<AnalyticsSettingsConfig | null>;
}

export const DatabaseContext = createContext<DatabaseContextValue | null>(null);

export function useDatabase(): DatabaseContextValue {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error('useDatabase must be used within a DatabaseProvider.');
  }
  return context;
}
