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
    expect(categories).toEqual([{ category: 'Dining', total: -60, gross: 120, reimbursed: 60, net: 60 }]);
  });

  it('nets same-category refunds too, keeps fully reimbursed categories visible, and matches the KPI totals', async () => {
    const db = await freshDb();
    await tx(db, '2026-03-02', 'GROCER', -100, 'Groceries');
    await tx(db, '2026-03-03', 'GROCER REFUND', 25, 'Groceries');
    const { id: flight } = await tx(db, '2026-03-04', 'AIRLINE', -300, 'Travel');
    const { id: payback } = await tx(db, '2026-03-20', 'EMPLOYER', 300, 'Income');
    await tx(db, '2026-03-25', 'PAYCHECK', 2000, 'Income');
    await f.linkReimbursement(db, payback, flight);

    const range = { startDate: '2026-03-01', endDate: '2026-03-31' };
    const breakdown = await q.getSpendingByCategory(db, range);
    expect(breakdown.categories).toEqual([{ category: 'Groceries', total: -75, gross: 100, reimbursed: 25, net: 75 }]);
    expect(breakdown.reimbursed_categories).toEqual([{ category: 'Travel', total: -0, gross: 300, reimbursed: 300, net: 0 }]);
    expect(breakdown.total_gross_expenses).toBe(400);
    expect(breakdown.total_net_expenses).toBe(75);

    // A linked payback counts as a reimbursement even in an excluded category like Income.
    const kpis = await q.getKpis(db, '2026-03');
    expect(kpis.net_expenses).toBe(75);
    expect(kpis.total_income).toBe(2000); // the linked payback isn't income
    expect((await f.getYearSummary(db, 2026)).income).toBe(2000);
    const [trend] = await q.getSpendingTrend(db, range);
    expect(trend.net_expenses).toBe(75);
    const [budgetMonth] = await f.getMonthlySavingsRate(db, { months: 1, today: '2026-03-31' });
    expect(budgetMonth.spent).toBe(75);
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

describe('monthly savings rate', () => {
  it('matches the year summary rules month by month', async () => {
    const db = await freshDb();
    await tx(db, '2026-01-15', 'PAYCHECK', 4000, 'Income');
    await tx(db, '2026-01-20', 'RENT', -1500, 'Housing');
    const { id: dinner } = await tx(db, '2026-02-05', 'DINNER', -200, 'Dining');
    const { id: refund } = await tx(db, '2026-02-06', 'VENMO', 50, 'Reimbursement');
    await f.linkReimbursement(db, refund, dinner);
    await tx(db, '2025-12-31', 'OLD', -999, 'Misc');
    const series = await f.getMonthlySavingsRate(db, { months: 3, today: '2026-03-10' });
    expect(series.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(series[0]).toMatchObject({ income: 4000, spent: 1500, saved: 2500 });
    expect(series[0].savingsRate).toBeCloseTo(0.625);
    expect(series[1]).toMatchObject({ income: 0, spent: 150, savingsRate: null });
    expect(series[2]).toMatchObject({ income: 0, spent: 0, savingsRate: null });
  });

  it('lists categories for pickers', async () => {
    const db = await freshDb();
    await tx(db, '2026-01-20', 'RENT', -1500, 'Housing');
    await f.setBudget(db, 'Travel', 100);
    expect(await f.getCategoryNames(db)).toEqual(['Housing', 'Travel']);
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

describe('reimbursements received in a later month', () => {
  it('count in the expense month when linked, and stay in the month received when not', async () => {
    const db = await freshDb();
    const { id: dinner } = await tx(db, '2026-03-28', 'DINNER', -120, 'Dining');
    const { id: payback } = await tx(db, '2026-04-03', 'VENMO FROM SAM', 60, 'Reimbursement');
    await tx(db, '2026-04-05', 'GROCER', -50, 'Groceries');
    await tx(db, '2026-04-06', 'GROCER REFUND', 10, 'Groceries');
    await f.linkReimbursement(db, payback, dinner);

    const march = await q.getKpis(db, '2026-03');
    const april = await q.getKpis(db, '2026-04');
    expect([march.gross_expenses, march.total_reimbursements, march.net_expenses]).toEqual([120, 60, 60]);
    expect([april.gross_expenses, april.total_reimbursements, april.net_expenses]).toEqual([50, 10, 40]);
    // Cash flow keeps the real deposit date.
    expect(april.net_flow).toBe(20);

    const trend = await q.getSpendingTrend(db, { startDate: '2026-03-01', endDate: '2026-04-30' });
    expect(trend.map((m) => [m.month, m.net_expenses, m.reimbursed_later])).toEqual([['2026-03', 60, 60], ['2026-04', 40, 0]]);

    const marchCats = await q.getSpendingByCategory(db, { startDate: '2026-03-01', endDate: '2026-03-31' });
    expect(marchCats.categories.map((c) => [c.category, c.net])).toEqual([['Dining', 60]]);
    const aprilCats = await q.getSpendingByCategory(db, { startDate: '2026-04-01', endDate: '2026-04-30' });
    expect(aprilCats.categories.map((c) => [c.category, c.net])).toEqual([['Groceries', 40]]);

    const daily = await q.getDailySpending(db, { startDate: '2026-03-01', endDate: '2026-04-30' });
    expect(daily.find((d) => d.date === '2026-03-28').net_expenses).toBe(60);

    await f.setBudget(db, 'Dining', 100);
    const [budget] = await f.getBudgetProgress(db, '2026-03', '2026-03-31');
    expect(budget.spent).toBe(60);
  });

  it('suggests the expense a credit most likely pays back', async () => {
    const db = await freshDb();
    const { id: dinner } = await tx(db, '2026-03-28', 'DINNER', -120, 'Dining');
    const { id: hotel } = await tx(db, '2026-02-10', 'HOTEL', -300, 'Travel');
    await f.addTagToTransactions(db, [hotel], 'reimbursable');
    await tx(db, '2026-03-30', 'COFFEE', -5, 'Dining');
    const { id: venmo } = await tx(db, '2026-04-03', 'VENMO FROM SAM', 40, 'Reimbursement');
    const { id: work } = await tx(db, '2026-04-04', 'EMPLOYER EXPENSES', 300, 'Reimbursement');

    const forVenmo = await f.suggestReimbursementLinks(db, venmo);
    expect(forVenmo[0]).toMatchObject({ id: dinner, reason: '1/3 of the bill' });
    expect(forVenmo.some((s) => s.description === 'COFFEE')).toBe(false);

    const forWork = await f.suggestReimbursementLinks(db, work);
    expect(forWork[0]).toMatchObject({ id: hotel, reason: 'same amount, tagged reimbursable' });

    // Once the hotel is fully paid back it is no longer suggested.
    await f.linkReimbursement(db, work, hotel);
    const { id: another } = await tx(db, '2026-04-05', 'EMPLOYER EXPENSES', 300, 'Reimbursement');
    expect((await f.suggestReimbursementLinks(db, another)).some((s) => s.id === hotel)).toBe(false);
  });
});

describe('picking a reimbursement link by hand', () => {
  it('finds expenses from any date by name, category or amount, nearest first', async () => {
    const db = await freshDb();
    const { id: old } = await tx(db, '2025-01-10', 'CONCERT TICKETS', -240, 'Entertainment');
    const { id: recent } = await tx(db, '2026-05-01', 'GROCER', -42.5);
    await tx(db, '2026-05-03', 'PAYROLL', 2000, 'Income');
    const { id: credit } = await tx(db, '2026-05-20', 'VENMO CASHOUT', 120, 'Income');

    const search = (query) => f.searchLinkCandidates(db, { side: 'expense', query, nearDate: '2026-05-20', excludeId: credit });
    expect((await search('')).map((row) => row.id)).toEqual([recent, old]);
    expect((await search('concert')).map((row) => row.id)).toEqual([old]);
    expect((await search('entertain')).map((row) => row.id)).toEqual([old]);
    expect((await search('$42.50')).map((row) => row.id)).toEqual([recent]);
    expect(await search('100%')).toEqual([]);

    await f.linkReimbursement(db, credit, old);
    const [match] = await search('concert');
    expect(match.repaid).toBe(120);
  });

  it('lists only credits that are not linked yet', async () => {
    const db = await freshDb();
    const { id: expense } = await tx(db, '2026-05-01', 'DINNER', -90);
    const { id: linked } = await tx(db, '2026-05-02', 'VENMO FROM SAM', 30, 'Income');
    const { id: open } = await tx(db, '2026-05-03', 'VENMO FROM ALEX', 30, 'Income');
    await f.linkReimbursement(db, linked, expense);
    const rows = await f.searchLinkCandidates(db, { side: 'credit', query: 'venmo', nearDate: '2026-05-01', excludeId: expense });
    expect(rows.map((row) => row.id)).toEqual([open]);
  });
});
