import { dateStamp, toCsv } from './csv.js';

const SOURCE_LABEL = { fidelity: 'Fidelity snapshot', manual: 'Entered by hand' };
const blank = (value) => (value === null || value === undefined ? '' : value);

/**
 * One row per recorded date, oldest first. "Net worth" is the figure the tab shows (the
 * recorded total plus the accounts outside Fidelity); each outside account gets its own column.
 */
export function netWorthHistoryToCsv(history) {
  const outsideNames = [...new Set(history.flatMap((p) => Object.keys(p.outsideByAccount ?? {})))].sort();
  const fields = ['Date', 'Net worth', 'Recorded total', 'Outside Fidelity', ...outsideNames, 'Assets', 'Liabilities', 'Source'];
  const rows = [...history]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => [
      p.date,
      p.netWorth,
      p.recorded,
      p.outside,
      ...outsideNames.map((name) => blank(p.outsideByAccount?.[name])),
      blank(p.assets),
      blank(p.liabilities),
      SOURCE_LABEL[p.source] ?? p.source,
    ]);
  return toCsv(fields, rows);
}

/**
 * One row per account per date, oldest first: every account in each pasted Fidelity snapshot,
 * then the accounts outside Fidelity counted on that date.
 */
export function netWorthAccountsToCsv(history) {
  const fields = ['Date', 'Group', 'Category', 'Account', 'Institution', 'Type', 'Account number', 'Balance', 'Balance updated'];
  const rows = [];
  for (const p of [...history].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const a of p.accounts ?? []) {
      rows.push([
        p.date,
        a.group === 'liability' ? 'Liability' : 'Asset',
        a.category,
        a.name,
        a.institution ?? '',
        a.type ?? '',
        a.mask ? `…${a.mask}` : '',
        blank(a.balance),
        a.updated ?? '',
      ]);
    }
    for (const [name, balance] of Object.entries(p.outsideByAccount ?? {})) {
      rows.push([p.date, balance < 0 ? 'Liability' : 'Asset', 'Outside Fidelity', name, '', '', '', balance, '']);
    }
  }
  return toCsv(fields, rows);
}

export function netWorthFileName(kind, today = new Date()) {
  return `betterview-net-worth${kind === 'accounts' ? '-accounts' : ''}-${dateStamp(today)}.csv`;
}
