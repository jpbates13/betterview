import { dateStamp, toCsv } from './csv.js';

// Builds the CSV for an export of transactions. The first five columns match the
// built-in Fidelity layout (Date, Description, Amount, Account, Category), so an
// exported file can be imported again without a mapping.
const COLUMNS = [
  ['Date', (tx) => tx.date],
  ['Description', (tx) => tx.description],
  ['Amount', (tx) => tx.amount],
  ['Account', (tx) => tx.account],
  ['Category', (tx) => tx.category],
  ['Merchant', (tx) => tx.merchant ?? ''],
  ['Status', (tx) => transactionStatus(tx)],
  ['Tags', (tx) => (tx.tags || []).join('; ')],
  ['Split', (tx) => (tx.is_split ? 'Yes' : '')],
  ['Rule', (tx) => tx.applied_rule_name ?? ''],
  ['Source file', (tx) => tx.source_file ?? ''],
  ['ID', (tx) => tx.id],
];

// Same wording as the status badge on the Transactions table.
export function transactionStatus(tx) {
  if (tx.is_excluded) return 'Excluded';
  if (tx.amount > 0) return tx.category?.toLowerCase() === 'income' ? 'Income' : 'Reimbursement';
  if (tx.amount < 0) return 'Expense';
  return 'Included';
}

export function transactionsToCsv(transactions) {
  return toCsv(
    COLUMNS.map(([name]) => name),
    transactions.map((tx) => COLUMNS.map(([, get]) => get(tx))),
  );
}

export function exportFileName(scope, today = new Date()) {
  const stamp = dateStamp(today);
  return scope === 'all' ? `betterview-transactions-${stamp}.csv` : `betterview-transactions-${scope}-${stamp}.csv`;
}
