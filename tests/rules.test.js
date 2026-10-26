import { describe, expect, it } from 'vitest';
import { csvFile, makeDb, visibleRows } from './testDb.js';
import * as q from '../src/dbQueries.js';
import { importCsvToDatabase } from '../src/csvImporter.js';

const header = 'Date,Description,Amount,Account,Category\n';

const categorize = (column, value, category, extra = {}) => ({
  name: `${column} ${value}`,
  match_payload: JSON.stringify({ match_type: 'all', conditions: [{ column, operator: 'contains', value }] }),
  action_type: 'categorize',
  action_payload: category,
  ...extra,
});

const freshDb = async () => {
  const db = makeDb();
  await q.bootstrapSchema(db);
  return db;
};

describe('merchant conditions', () => {
  it('match imported rows on their cleaned merchant name', async () => {
    const db = await freshDb();
    await q.createRule(db, categorize('merchant', 'blue bottle', 'Coffee'));
    await importCsvToDatabase(csvFile(
      `${header}2026-03-01,SQ *BLUE BOTTLE COFFEE #1234 SAN FRANCISCO CA,-6.5,Card,Food\n2026-03-02,SAFEWAY #44,-50,Card,Food\n`,
    ), db);
    expect(visibleRows(db)).toEqual([
      ['SQ *BLUE BOTTLE COFFEE #1234 SAN FRANCISCO CA', -6.5, 'Coffee'],
      ['SAFEWAY #44', -50, 'Food'],
    ]);
  });

  it('do not match on text that only appears in the raw description', async () => {
    const db = await freshDb();
    // "#1234" is stripped from the merchant name, so a merchant rule must not see it.
    await q.createRule(db, categorize('merchant', '1234', 'Coffee'));
    await importCsvToDatabase(csvFile(`${header}2026-03-01,SQ *BLUE BOTTLE COFFEE #1234,-6.5,Card,Food\n`), db);
    expect(visibleRows(db)).toEqual([['SQ *BLUE BOTTLE COFFEE #1234', -6.5, 'Food']]);
  });

  it('apply to existing rows and record the rule that changed them', async () => {
    const db = await freshDb();
    await q.createTransaction(db, { date: '2026-03-01', description: 'TST* JOES PIZZA #9 BROOKLYN NY', amount: -20, account: 'C', category: 'Misc' });
    await q.createTransaction(db, { date: '2026-03-02', description: 'SHELL OIL 5555', amount: -40, account: 'C', category: 'Misc' });
    await q.createRule(db, categorize('merchant', 'joes pizza', 'Dining'));
    const [saved] = await q.getRules(db);
    expect(await q.executeRuleOnDatabase(db, saved)).toBe(1);
    expect(visibleRows(db)).toEqual([
      ['TST* JOES PIZZA #9 BROOKLYN NY', -20, 'Dining'],
      ['SHELL OIL 5555', -40, 'Misc'],
    ]);
    const applied = db.raw.exec('SELECT applied_rule_id FROM transactions ORDER BY id')[0].values.map((r) => r[0]);
    expect(applied).toEqual([saved.id, null]);
  });

  it('fall back to a cleaned description when a row has no merchant yet', async () => {
    const db = await freshDb();
    const { id } = await q.createTransaction(db, { date: '2026-03-01', description: 'SQ *BLUE BOTTLE COFFEE', amount: -5, account: 'C', category: 'Misc' });
    db.raw.exec('UPDATE transactions SET merchant = NULL WHERE id = ?', [id]);
    const rows = await q.previewRule(db, categorize('merchant', 'blue bottle', 'Coffee'));
    expect(rows.map((r) => r.id)).toEqual([id]);
  });

  it('combine with other columns', async () => {
    const db = await freshDb();
    await q.createRule(db, {
      name: 'big amazon',
      match_payload: JSON.stringify({
        match_type: 'all',
        conditions: [
          { column: 'merchant', operator: 'starts with', value: 'amazon' },
          { column: 'amount', operator: 'less_than', value: '-100' },
        ],
      }),
      action_type: 'categorize',
      action_payload: 'Big purchases',
    });
    await importCsvToDatabase(csvFile(`${header}2026-04-01,AMAZON MKTPLACE,-150,C,Shopping\n2026-04-02,AMAZON MKTPLACE,-15,C,Shopping\n`), db);
    expect(visibleRows(db).map((r) => r[2])).toEqual(['Big purchases', 'Shopping']);
  });
});

describe('previewRule', () => {
  it('lists matching rows with the category change without writing anything', async () => {
    const db = await freshDb();
    await q.createTransaction(db, { date: '2026-03-01', description: 'NETFLIX.COM', amount: -15.99, account: 'C', category: 'Misc' });
    await q.createTransaction(db, { date: '2026-03-02', description: 'NETFLIX.COM', amount: -15.99, account: 'C', category: 'Subscriptions' });
    await q.createTransaction(db, { date: '2026-03-03', description: 'HULU', amount: -9.99, account: 'C', category: 'Misc' });

    const rows = await q.previewRule(db, categorize('description', 'netflix', 'Subscriptions'));
    expect(rows.map((r) => r.change)).toEqual(['Misc → Subscriptions', 'already in category']);
    expect(rows[0]).toMatchObject({ description: 'NETFLIX.COM', amount: -15.99 });
    expect(visibleRows(db).map((r) => r[2])).toEqual(['Misc', 'Subscriptions', 'Misc']);
  });

  it('shows split lines and skips rows the split does not fit', async () => {
    const db = await freshDb();
    await q.createTransaction(db, { date: '2026-03-01', description: 'COSTCO', amount: -100, account: 'C', category: 'Misc' });
    await q.createTransaction(db, { date: '2026-03-02', description: 'COSTCO', amount: -30, account: 'C', category: 'Misc' });
    const rows = await q.previewRule(db, {
      match_payload: { match_type: 'all', conditions: [{ column: 'merchant', operator: 'equals', value: 'costco' }] },
      action_type: 'split',
      action_payload: { splits: [{ category: 'Groceries', type: 'fixed', value: -60 }, { category: 'Home', type: 'remainder' }] },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].change).toBe('Groceries -60.00 + Home -40.00');
  });

  it('honours match_type any', async () => {
    const db = await freshDb();
    await q.createTransaction(db, { date: '2026-03-01', description: 'UBER TRIP', amount: -12, account: 'Card', category: 'Misc' });
    await q.createTransaction(db, { date: '2026-03-02', description: 'LYFT RIDE', amount: -14, account: 'Card', category: 'Misc' });
    await q.createTransaction(db, { date: '2026-03-03', description: 'SHELL', amount: -40, account: 'Card', category: 'Misc' });
    const rows = await q.previewRule(db, {
      match_payload: {
        match_type: 'any',
        conditions: [
          { column: 'merchant', operator: 'contains', value: 'uber' },
          { column: 'description', operator: 'contains', value: 'lyft' },
        ],
      },
      action_type: 'categorize',
      action_payload: 'Rides',
    });
    expect(rows.map((r) => r.description)).toEqual(['UBER TRIP', 'LYFT RIDE']);
  });

  it('matches the same rows a run then changes', async () => {
    const db = await freshDb();
    await q.createTransaction(db, { date: '2026-03-01', description: 'SPOTIFY USA', amount: -11.99, account: 'C', category: 'Misc' });
    await q.createTransaction(db, { date: '2026-04-01', description: 'SPOTIFY USA', amount: -11.99, account: 'C', category: 'Misc' });
    await q.createRule(db, categorize('merchant', 'spotify', 'Music'));
    const [saved] = await q.getRules(db);
    const preview = await q.previewRule(db, saved);
    expect(await q.executeRuleOnDatabase(db, saved)).toBe(preview.length);
  });
});

describe('date conditions', () => {
  const mortgageRule = (operator, date, saving) => ({
    name: `mortgage ${operator} ${date}`,
    match_payload: JSON.stringify({
      match_type: 'all',
      conditions: [
        { column: 'description', operator: 'contains', value: 'cmg' },
        { column: 'date', operator, value: date },
      ],
    }),
    action_type: 'split',
    action_payload: { splits: [{ category: 'Saving', type: 'fixed', value: saving }, { category: 'Home', type: 'remainder' }] },
  });

  it('pick the split amount by date on import, including the boundary day', async () => {
    const db = await freshDb();
    await q.createRule(db, mortgageRule('before', '2026-08-24', -585));
    await q.createRule(db, mortgageRule('on_or_after', '2026-08-24', -597.46));
    await importCsvToDatabase(csvFile(
      `${header}2026-07-24,CMG FINANCIAL,-2432.21,Chk,Mortgage\n2026-08-24,CMG FINANCIAL,-2432.21,Chk,Mortgage\n2026-09-24,CMG MORTGAGE,-2432.21,Chk,Mortgage\n`,
    ), db);
    expect(visibleRows(db)).toEqual([
      ['CMG FINANCIAL', -585, 'Saving'],
      ['CMG FINANCIAL', -1847.21, 'Home'],
      ['CMG FINANCIAL', -597.46, 'Saving'],
      ['CMG FINANCIAL', -1834.75, 'Home'],
      ['CMG MORTGAGE', -597.46, 'Saving'],
      ['CMG MORTGAGE', -1834.75, 'Home'],
    ]);
  });

  it('limit a sweep of existing rows to the date range', async () => {
    const db = await freshDb();
    await q.createTransaction(db, { date: '2026-08-23', description: 'CMG FINANCIAL', amount: -2432.21, account: 'C', category: 'Mortgage' });
    await q.createTransaction(db, { date: '2026-08-24', description: 'CMG FINANCIAL', amount: -2432.21, account: 'C', category: 'Mortgage' });
    await q.createRule(db, mortgageRule('on_or_after', '2026-08-24', -597.46));
    const [saved] = await q.getRules(db);
    expect((await q.previewRule(db, saved)).map((row) => row.date)).toEqual(['2026-08-24']);
    await q.executeRuleOnDatabase(db, saved);
    expect(visibleRows(db)).toEqual([
      ['CMG FINANCIAL', -2432.21, 'Mortgage'],
      ['CMG FINANCIAL', -597.46, 'Saving'],
      ['CMG FINANCIAL', -1834.75, 'Home'],
    ]);
  });

  it('never match a row or value that is not a date', async () => {
    const db = await freshDb();
    await q.createTransaction(db, { date: '2026-08-24', description: 'CMG FINANCIAL', amount: -100, account: 'C', category: 'Mortgage' });
    await q.createRule(db, mortgageRule('on_or_after', 'August', -50));
    const [saved] = await q.getRules(db);
    expect(await q.previewRule(db, saved)).toEqual([]);
  });
});
