import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeDb } from './testDb.js';
import * as q from '../src/dbQueries.js';
import { parseFidelityNetWorth, parseHistoryJson, parseNetWorthHistory } from '../src/db/netWorthParser.js';
import {
  deleteNetWorthPoint, getNetWorthHistory, importNetWorthPoints, pointBefore, saveNetWorthSnapshot, setNetWorthPoint,
} from '../src/db/netWorth.js';

// An anonymized copy of the Net worth page as copied from Fidelity Full View.
const page = readFileSync(new URL('./fixtures/fidelity-net-worth.txt', import.meta.url), 'utf8');

const freshDb = async () => {
  const db = makeDb();
  await q.bootstrapSchema(db);
  return db;
};

describe('Fidelity net worth page', () => {
  const parsed = parseFidelityNetWorth(page);

  it('reads the totals and the as-of date, ignoring nav and disclaimers', () => {
    expect(parsed.date).toBe('2026-10-12');
    expect(parsed.netWorth).toBe(339710.25);
    expect(parsed.assets).toBe(539750.75);
    expect(parsed.liabilities).toBe(-200040.5);
    expect(parsed.warnings).toEqual([]);
  });

  it('reads the category totals', () => {
    expect(parsed.categories.map((c) => [c.group, c.name, c.total])).toEqual([
      ['asset', 'Cash equivalents', 9750.25],
      ['asset', 'Investments', 230000.5],
      ['asset', 'Real estate', 300000],
      ['liability', 'Credit cards', -40.5],
      ['liability', 'Loans', -200000],
    ]);
  });

  it('reads every account line with its type, last digits and institution', () => {
    expect(parsed.accounts).toHaveLength(19);
    const byName = Object.fromEntries(parsed.accounts.map((a) => [a.name, a]));
    expect(byName['Cash Management']).toEqual({
      group: 'asset', category: 'Cash equivalents', name: 'Cash Management', balance: 8400.25,
      type: 'Cash management', mask: '1111', updated: 'Just now', institution: 'Fidelity Investments',
    });
    expect(byName['TD BEYOND CHECKING']).toMatchObject({ balance: 100, type: 'cash', updated: '144 weeks ago' });
    expect(byName['Acme Retirement Benefit Plan']).toMatchObject({ balance: null, type: 'Defined benefits', mask: '001' });
    expect(byName['(M) Condo']).toMatchObject({ category: 'Real estate', balance: 300000, updated: '09/12/2025', institution: 'Manual Entry' });
    expect(byName['Venture X']).toMatchObject({ group: 'liability', balance: -25, type: 'CreditCard' });
    expect(byName['Citi Double Cash Card-1234']).toMatchObject({ balance: 0, institution: 'Citibank Online' });
    expect(byName['1 EXAMPLE STREET UNIT 2, SPRINGFIELD, MA 01101']).toMatchObject({ category: 'Loans', balance: -200000, type: 'Mortgage' });
  });

  it('copes with tabs and Windows line endings', () => {
    const messy = page.replace(/\n/g, '\r\n').replace('Venture X-$25.00CreditCard', 'Venture X\t-$25.00\tCreditCard\t');
    const again = parseFidelityNetWorth(messy);
    expect(again.accounts.find((a) => a.name === 'Venture X')).toMatchObject({ balance: -25, type: 'CreditCard', updated: '2 days ago' });
    expect(again.warnings).toEqual([]);
  });

  it('warns when the accounts do not add up to the totals', () => {
    const off = parseFidelityNetWorth(page.replace('ROTH IRA$40,000.00', 'ROTH IRA$40,100.00'));
    expect(off.warnings[0]).toMatch(/Asset accounts add up to 539850.75/);
  });

  it('returns null for text that is not the page', () => {
    expect(parseFidelityNetWorth('hello there')).toBeNull();
  });
});

describe('pasted net worth history', () => {
  it('reads a date and a figure per line in common formats', () => {
    const { points, skipped } = parseNetWorthHistory([
      'Date\tNet worth',
      '10/12/2026\t$397,784.74',
      '2026-07-14, 372982.55',
      'Jan 31, 2025 $250,000',
      'Oct-09-2024 -$1,200.50',
      'not a row 123',
    ].join('\n'));
    expect(points).toEqual([
      { date: '2024-10-09', netWorth: -1200.5 },
      { date: '2025-01-31', netWorth: 250000 },
      { date: '2026-07-14', netWorth: 372982.55 },
      { date: '2026-10-12', netWorth: 397784.74 },
    ]);
    expect(skipped).toEqual(['not a row 123']);
  });

  it('reads month-only dates as month ends and abbreviated amounts', () => {
    const { points, skipped } = parseNetWorthHistory([
      'Jan 2023 $250K',
      "February '23\t$1.25M",
      '03/2023 251,000',
      '2023-04: $252,500.50',
      'Dec 12, 2023 $260,000',
    ].join('\n'));
    expect(points).toEqual([
      { date: '2023-01-31', netWorth: 250000 },
      { date: '2023-02-28', netWorth: 1250000 },
      { date: '2023-03-31', netWorth: 251000 },
      { date: '2023-04-30', netWorth: 252500.5 },
      { date: '2023-12-12', netWorth: 260000 },
    ]);
    expect(skipped).toEqual([]);
  });

  it('keeps only the hovered chart point from a copied Credit Karma page', () => {
    const page = readFileSync(new URL('./fixtures/credit-karma-home.txt', import.meta.url), 'utf8');
    expect(parseNetWorthHistory(page)).toEqual({ points: [{ date: '2025-06-30', netWorth: 210450 }], skipped: [] });
  });

  it('finds the longest dated series in pasted chart JSON', () => {
    const response = JSON.stringify({
      data: {
        netWorth: {
          current: { amount: 350000 },
          accounts: [{ name: 'Checking', balance: 500 }],
          transactions: [1, 2, 3, 4, 5].map((d) => ({ date: `2024-05-0${d}`, amount: -10 })),
          history: [
            { date: '2024-01-31T00:00:00Z', netWorth: { amount: 200000 }, assets: { amount: 400000 } },
            { date: '2024-02-29T00:00:00Z', netWorth: { amount: 205000.5 }, assets: { amount: 405000 } },
            { date: '2024-03-31T00:00:00Z', netWorth: { amount: 199000 }, assets: { amount: 401000 } },
          ],
        },
      },
    });
    expect(parseNetWorthHistory(response).points).toEqual([
      { date: '2024-01-31', netWorth: 200000 },
      { date: '2024-02-29', netWorth: 205000.5 },
      { date: '2024-03-31', netWorth: 199000 },
    ]);
  });

  it('reads timestamp/value pairs and plain value fields', () => {
    expect(parseHistoryJson(JSON.stringify([[Date.UTC(2024, 0, 31), 100], [Date.UTC(2024, 1, 29), 110]])).points).toEqual([
      { date: '2024-01-31', netWorth: 100 },
      { date: '2024-02-29', netWorth: 110 },
    ]);
    expect(parseHistoryJson(JSON.stringify({ points: [{ x: 1706659200, y: '250,000' }, { x: 1709164800, y: '251,000' }] })).points).toEqual([
      { date: '2024-01-31', netWorth: 250000 },
      { date: '2024-02-29', netWorth: 251000 },
    ]);
    expect(parseHistoryJson('{"no": "series"}')).toBeNull();
    expect(parseHistoryJson('not json')).toBeNull();
  });

  it('pairs a date with the figure on the next line', () => {
    const { points } = parseNetWorthHistory('Jul 14, 2026\n$372,982.55\nJul 15, 2026\n$373,100.00');
    expect(points).toEqual([
      { date: '2026-07-14', netWorth: 372982.55 },
      { date: '2026-07-15', netWorth: 373100 },
    ]);
  });
});

describe('net worth history storage', () => {
  it('saves a pasted snapshot with its accounts and replaces it on re-paste', async () => {
    const db = await freshDb();
    const parsed = parseFidelityNetWorth(page);
    await saveNetWorthSnapshot(db, parsed);
    await saveNetWorthSnapshot(db, { ...parsed, netWorth: 340000 });
    const history = await getNetWorthHistory(db);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ date: '2026-10-12', netWorth: 340000, source: 'fidelity', assets: 539750.75 });
    expect(history[0].accounts).toHaveLength(19);
  });

  it('backfills hand-entered figures without touching pasted snapshots', async () => {
    const db = await freshDb();
    await saveNetWorthSnapshot(db, parseFidelityNetWorth(page));
    const result = await importNetWorthPoints(db, [
      { date: '2026-01-01', netWorth: 300000 },
      { date: '2026-10-12', netWorth: 1 },
    ]);
    expect(result).toEqual({ added: 1, updated: 0, keptSnapshots: 1 });
    expect((await importNetWorthPoints(db, [{ date: '2026-01-01', netWorth: 301000 }])).updated).toBe(1);

    const history = await getNetWorthHistory(db);
    expect(history.map((p) => [p.date, p.netWorth, p.source])).toEqual([
      ['2026-01-01', 301000, 'manual'],
      ['2026-10-12', 339710.25, 'fidelity'],
    ]);
    await expect(setNetWorthPoint(db, { date: '2026-10-12', netWorth: 5 })).rejects.toThrow(/pasted Fidelity snapshot/);
  });

  it('edits, moves and deletes a hand-entered figure', async () => {
    const db = await freshDb();
    await setNetWorthPoint(db, { date: '2026-02-01', netWorth: '$310,000.50' });
    const [point] = await getNetWorthHistory(db);
    await setNetWorthPoint(db, { id: point.id, date: '2026-03-01', netWorth: 320000 });
    let history = await getNetWorthHistory(db);
    expect(history.map((p) => [p.date, p.netWorth])).toEqual([['2026-03-01', 320000]]);
    await deleteNetWorthPoint(db, history[0].id);
    history = await getNetWorthHistory(db);
    expect(history).toEqual([]);
  });

  it('finds the point to compare against', () => {
    const history = [
      { date: '2025-10-01', netWorth: 1 },
      { date: '2026-07-01', netWorth: 2 },
      { date: '2026-10-12', netWorth: 3 },
    ];
    expect(pointBefore(history, 90).date).toBe('2026-07-01');
    expect(pointBefore(history, 365).date).toBe('2025-10-01');
    expect(pointBefore(history.slice(2), 90)).toBeNull();
  });
});
