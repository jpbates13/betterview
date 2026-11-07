import Papa from 'papaparse';

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

// Spreadsheets run a cell that starts with = + - @ as a formula. Text from a bank
// file shouldn't, so it gets a leading apostrophe; plain numbers are left alone.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;
const safeText = (value) => {
  const text = String(value ?? '');
  return FORMULA_START.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
};

export function transactionsToCsv(transactions) {
  const fields = COLUMNS.map(([name]) => name);
  const data = transactions.map((tx) => COLUMNS.map(([, get]) => {
    const value = get(tx);
    return typeof value === 'number' ? value : safeText(value);
  }));
  // The byte order mark makes Excel read the file as UTF-8.
  return `\uFEFF${Papa.unparse({ fields, data }, { newline: '\r\n' })}\r\n`;
}

export function exportFileName(scope, today = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  return scope === 'all' ? `betterview-transactions-${stamp}.csv` : `betterview-transactions-${scope}-${stamp}.csv`;
}
