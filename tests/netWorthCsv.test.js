import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import { netWorthAccountsToCsv, netWorthFileName, netWorthHistoryToCsv } from '../src/netWorthCsv.js';

const parse = (csv) => Papa.parse(csv.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data;

const point = (over) => ({
  id: 1, date: '2026-10-12', netWorth: 400000, recorded: 400000, outside: 0, outsideByAccount: {},
  assets: null, liabilities: null, source: 'manual', categories: [], accounts: [], ...over,
});

const history = [
  point({
    id: 2, date: '2026-10-12', source: 'fidelity', recorded: 390000, outside: 10000, netWorth: 400000,
    outsideByAccount: { 'Optum HSA': 10000 }, assets: 395000, liabilities: -5000,
    accounts: [
      { group: 'asset', category: 'Investments', name: 'Brokerage', balance: 395000, type: 'Brokerage', mask: '1234', updated: 'Just now', institution: 'Fidelity' },
      { group: 'liability', category: 'Credit cards', name: '=Venture X', balance: -5000, type: 'CreditCard', mask: '', updated: '2 days ago', institution: 'Capital One' },
      { group: 'asset', category: 'Cash', name: 'Locked', balance: null, type: 'Checking', mask: '', updated: '', institution: 'Bank' },
    ],
  }),
  point({ id: 1, date: '2025-01-31', netWorth: 310000, recorded: 310000 }),
];

describe('netWorthHistoryToCsv', () => {
  it('writes one row per date, oldest first, with outside accounts split out', () => {
    const rows = parse(netWorthHistoryToCsv(history));
    expect(Object.keys(rows[0])).toEqual(['Date', 'Net worth', 'Recorded total', 'Outside Fidelity', 'Optum HSA', 'Assets', 'Liabilities', 'Source']);
    expect(rows[0]).toMatchObject({ Date: '2025-01-31', 'Net worth': '310000', 'Optum HSA': '', Assets: '', Source: 'Entered by hand' });
    expect(rows[1]).toMatchObject({
      Date: '2026-10-12', 'Net worth': '400000', 'Recorded total': '390000', 'Outside Fidelity': '10000',
      'Optum HSA': '10000', Assets: '395000', Liabilities: '-5000', Source: 'Fidelity snapshot',
    });
  });

  it('starts with a byte order mark and ends lines with CRLF', () => {
    const csv = netWorthHistoryToCsv(history);
    expect(csv.startsWith('\uFEFFDate,')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});

describe('netWorthAccountsToCsv', () => {
  it('lists every snapshot account and outside account per date', () => {
    const rows = parse(netWorthAccountsToCsv(history));
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ Date: '2026-10-12', Group: 'Asset', Account: 'Brokerage', 'Account number': '…1234', Balance: '395000' });
    expect(rows[1]).toMatchObject({ Group: 'Liability', Account: "'=Venture X", Balance: '-5000' });
    expect(rows[2]).toMatchObject({ Account: 'Locked', Balance: '' });
    expect(rows[3]).toMatchObject({ Category: 'Outside Fidelity', Account: 'Optum HSA', Balance: '10000' });
  });
});

describe('netWorthFileName', () => {
  it('stamps the local date', () => {
    const day = new Date(2026, 10, 7);
    expect(netWorthFileName('history', day)).toBe('betterview-net-worth-2026-11-07.csv');
    expect(netWorthFileName('accounts', day)).toBe('betterview-net-worth-accounts-2026-11-07.csv');
  });
});
