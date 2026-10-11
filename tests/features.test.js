import { describe, expect, it } from 'vitest';
import { csvFile, makeDb } from './testDb.js';
import * as q from '../src/dbQueries.js';
import * as f from '../src/db/features.js';
import { cleanMerchantName } from '../src/db/merchants.js';

const tx = (db, date, description, amount, category = 'Food', account = 'Card') =>
  q.createTransaction(db, { date, description, amount, account, category, manual_override: null });

const freshDb = async () => {
  const db = makeDb();
  await q.bootstrapSchema(db);
  return db;
};

describe('merchant names', () => {
  it.each([
    ['SQ *BLUE BOTTLE COFFEE #1234 SAN FRANCISCO CA', 'Blue Bottle Coffee'],
    ['TST* SHAKE SHACK 1234', 'Shake Shack'],
    ['NETFLIX.COM', 'Netflix.com'],
    ['AMAZON MKTPL*2K4LL0QJ3', 'Amazon Mktpl'],
    ['PAYPAL *SPOTIFYUSAI 4029357733', 'Spotifyusai'],
  ])('%s → %s', (raw, expected) => {
    expect(cleanMerchantName(raw)).toBe(expected);
  });

  it('applies merchant rules over the automatic cleanup', async () => {
    const db = await freshDb();
    const { addMerchantRule } = await import('../src/db/merchants-store.js');
    await tx(db, '2026-01-01', 'AMZN MKTP US*AB12CD', -10);
    await addMerchantRule(db, { pattern: 'amzn', merchant: 'Amazon' });
    expect(db.raw.exec('SELECT merchant FROM transactions')[0].values).toEqual([['Amazon']]);
  });
});

describe('budgets', () => {
  it('tracks spending against a monthly budget, net of linked reimbursements', async () => {
    const db = await freshDb();
    const { id: dinner } = await tx(db, '2026-03-05', 'DINNER', -120);
    await tx(db, '2026-03-10', 'GROCER', -30);
    const { id: refund } = await tx(db, '2026-03-12', 'VENMO FROM SAM', 60, 'Reimbursement');
    await tx(db, '2026-04-01', 'GROCER', -999);
    await f.setBudget(db, 'Food', 200);
    await f.linkReimbursement(db, refund, dinner);

    const [food] = await f.getBudgetProgress(db, '2026-03', '2026-03-15');
    expect(food.spent).toBe(90);
    expect(food.remaining).toBe(110);
    expect(food.isAheadOfPace).toBe(false);
  });
});

describe('recurring charges', () => {
  it('finds a monthly subscription and its price change', async () => {
    const db = await freshDb();
    for (const [date, amount] of [['2026-01-03', -15.49], ['2026-02-03', -15.49], ['2026-03-03', -15.49], ['2026-04-03', -17.99]]) {
      await tx(db, date, 'NETFLIX.COM', amount, 'Subscriptions');
    }
    await tx(db, '2026-02-14', 'RANDOM SHOP', -40);
    const [netflix, ...rest] = await f.detectRecurringCharges(db, { today: '2026-04-10' });
    expect(rest).toHaveLength(0);
    expect(netflix).toMatchObject({ merchant: 'Netflix.com', cadence: 'monthly', priceChange: 2.5, nextExpected: '2026-05-03', isStopped: false });
  });

  it('marks a series that stopped', async () => {
    const db = await freshDb();
    for (const date of ['2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01']) {
      await tx(db, date, 'GYM CO', -50, 'Health');
    }
    const [gym] = await f.detectRecurringCharges(db, { today: '2026-01-15' });
    expect(gym.isStopped).toBe(true);
  });
});

describe('tags and reimbursements', () => {
  it('tracks what is still owed on reimbursable expenses', async () => {
    const db = await freshDb();
    const { id: flight } = await tx(db, '2026-02-01', 'AIRLINE', -400, 'Travel');
    const { id: partial } = await tx(db, '2026-02-20', 'EMPLOYER EXPENSES', 250, 'Reimbursement');
    await f.setTransactionTags(db, flight, ['Reimbursable', 'work trip']);
    await f.linkReimbursement(db, partial, flight);
    const [status] = await f.getReimbursementStatus(db);
    expect(status).toMatchObject({ id: flight, repaid: 250, outstanding: 150, isSettled: false });
    const tags = await f.getTagSummary(db);
    expect(tags.map((t) => t.tag)).toEqual(['reimbursable', 'work-trip']);
    const [row] = await q.getTransactions(db, { tag: 'work-trip' });
    expect(row.tags).toEqual(['reimbursable', 'work-trip']);
  });

  it('nets linked reimbursements out of category spending', async () => {
    const db = await freshDb();
    const { id: dinner } = await tx(db, '2026-03-05', 'DINNER', -120, 'Dining');
    const { id: refund } = await tx(db, '2026-03-06', 'VENMO', 60, 'Reimbursement');
    await f.linkReimbursement(db, refund, dinner);
    const { categories } = await q.getSpendingByCategory(db, { startDate: '2026-03-01', endDate: '2026-03-31' });
    expect(categories).toEqual([{ category: 'Dining', total: -60 }]);
  });
});

describe('net worth', () => {
  it('carries snapshots forward with later transactions', async () => {
    const db = await freshDb();
    await f.setAccountBalance(db, { account: 'Checking', date: '2026-01-31', balance: 1000 });
    await f.setAccountBalance(db, { account: 'Card', date: '2026-01-31', balance: -200 });
    await tx(db, '2026-02-10', 'PAYCHECK', 500, 'Income', 'Checking');
    await tx(db, '2026-02-11', 'GROCER', -50, 'Food', 'Card');
    const series = await f.getNetWorthSeries(db, { months: 2, today: '2026-02-28' });
    expect(series.map((p) => [p.date, p.netWorth])).toEqual([['2026-01-31', 800], ['2026-02-28', 1250]]);
  });
});

describe('year summary and export', () => {
  it('summarises a year and exports CSV safely', async () => {
    const db = await freshDb();
    await tx(db, '2026-01-15', 'PAYCHECK', 4000, 'Income');
    await tx(db, '2026-01-20', 'RENT', -1500, 'Housing');
    await tx(db, '2026-02-20', '=HYPERLINK("x")', -10, 'Misc');
    const summary = await f.getYearSummary(db, 2026);
    expect(summary).toMatchObject({ income: 4000, netSpent: 1510 });
    expect(summary.savingsRate).toBeCloseTo(0.6225);
    const csv = f.transactionsToCsv(await q.getTransactions(db));
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('bulk edits', () => {
  it('recategorizes and refuses to delete split halves', async () => {
    const db = await freshDb();
    const { id: a } = await tx(db, '2026-01-01', 'A', -10);
    const { id: b } = await tx(db, '2026-01-02', 'B', -20);
    await f.bulkSetCategory(db, [a, b], 'Groceries');
    expect(db.raw.exec('SELECT DISTINCT category FROM transactions')[0].values).toEqual([['Groceries']]);
    const { created_ids: [half] } = await q.splitTransaction(db, b, { splits: [{ category: 'X', amount: -5 }, { category: 'Y', amount: -15 }] });
    await expect(f.bulkDelete(db, [a, half])).rejects.toThrow(/split halves/);
  });
});

describe('possible duplicates', () => {
  it('pairs the same charge imported from two files with different text', async () => {
    const db = await freshDb();
    const { importCsvToDatabase } = await import('../src/csvImporter.js');
    await importCsvToDatabase(csvFile('Date,Description,Amount,Account\n2026-03-01,COSTCO WHSE #123,-80,Card\n', 'a.csv'), db);
    await importCsvToDatabase(csvFile('Date,Description,Amount,Account\n2026-03-02,Costco,-80,Card\n', 'b.csv'), db);
    expect(await f.getPossibleDuplicates(db)).toHaveLength(1);
  });
});
