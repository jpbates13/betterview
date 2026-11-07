import type { Transaction } from './types';

export function transactionStatus(tx: Transaction): 'Excluded' | 'Income' | 'Reimbursement' | 'Expense' | 'Included';
export function transactionsToCsv(transactions: Transaction[]): string;
export function exportFileName(scope: 'all' | 'filtered' | 'selected', today?: Date): string;
