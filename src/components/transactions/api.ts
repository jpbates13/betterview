// Typed views of data-layer functions whose JS signatures TypeScript infers too narrowly
// (destructured options without defaults are inferred as unknown properties).
import { getTransactions as getTransactionsJs } from '../../dbQueries.js';
import { getUnlinkedCredits as getUnlinkedCreditsJs } from '../../db/features.js';
import type { DbHandle, Transaction } from './types';

export interface TransactionQuery {
  startDate?: string;
  endDate?: string;
  categories?: string[];
  importBatchId?: string;
  tag?: string;
  ids?: number[];
}

export const getTransactions = getTransactionsJs as unknown as (
  db: DbHandle,
  options?: TransactionQuery,
) => Promise<Transaction[]>;

export const getUnlinkedCredits = getUnlinkedCreditsJs as unknown as (
  db: DbHandle,
  options?: { aroundDate?: string; days?: number },
) => Promise<Array<Record<string, unknown>>>;
