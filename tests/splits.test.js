import { describe, expect, it } from 'vitest';
import { csvFile, makeDb, visibleRows } from './testDb.js';
import * as q from '../src/dbQueries.js';
import { importCsvToDatabase } from '../src/csvImporter.js';

const header = 'Date,Description,Amount,Account,Category\n';

describe('manual splits', () => {
  it('allows equal halves with the same description', async () => {
    const db = makeDb();
    await q.bootstrapSchema(db);
    const { id } = await q.createTransaction(db, { date: '2026-03-01', description: 'COSTCO', amount: -100, account: 'C', category: 'S' });
    await q.splitTransaction(db, id, { splits: [{ category: 'A', amount: -50 }, { category: 'B', amount: -50 }] });
    expect(visibleRows(db).map((r) => r[1])).toEqual([-50, -50]);
  });

  it('locks split halves until the split is undone', async () => {
    const db = makeDb();
    await q.bootstrapSchema(db);
    const { id } = await q.createTransaction(db, { date: '2026-03-01', description: 'COSTCO', amount: -100, account: 'C', category: 'S' });
    const { created_ids: [half] } = await q.splitTransaction(db, id, { splits: [{ category: 'A', amount: -60 }, { category: 'B', amount: -40 }] });
    await expect(q.deleteTransaction(db, half)).rejects.toThrow(/part of a split/);
    await q.undoSplitTransaction(db, half);
    expect(visibleRows(db)).toEqual([['COSTCO', -100, 'S']]);
  });
});

describe('split rules', () => {
  const rule = (match, splits) => ({
    name: match,
    match_payload: [{ column: 'description', operator: 'contains', value: match }],
    action_type: 'split',
    action_payload: { splits },
  });

  it('keeps both equal halves on import', async () => {
    const db = makeDb();
    await q.bootstrapSchema(db);
    await q.createRule(db, rule('rent', [{ category: 'Rent', type: 'fixed', value: -1000 }, { category: 'Rent', type: 'fixed', value: -1000 }]));
    await importCsvToDatabase(csvFile(`${header}2026-03-02,RENT,-2000,Checking,Housing\n`), db);
    expect(visibleRows(db).map((r) => r[1])).toEqual([-1000, -1000]);
  });

  it('leaves rows unsplit when the lines do not cover them', async () => {
    const db = makeDb();
    await q.bootstrapSchema(db);
    await q.createRule(db, rule('gym', [{ category: 'Health', type: 'fixed', value: -30 }, { category: 'Fun', type: 'fixed', value: -20 }]));
    await q.createRule(db, rule('dinner', [{ category: 'Food', type: 'percentage', value: 50 }, { category: 'Gifts', type: 'percentage', value: 25 }]));
    await importCsvToDatabase(csvFile(`${header}2026-05-01,GYM,-65,C,X\n2026-05-02,DINNER,-80,C,X\n`), db);
    expect(visibleRows(db).map((r) => r[1])).toEqual([-65, -80]);
  });

  it('applies a remainder split', async () => {
    const db = makeDb();
    await q.bootstrapSchema(db);
    await q.createRule(db, rule('dinner', [{ category: 'Food', type: 'percentage', value: 50 }, { category: 'Gifts', type: 'remainder' }]));
    await importCsvToDatabase(csvFile(`${header}2026-05-02,DINNER,-80,C,X\n`), db);
    expect(visibleRows(db)).toEqual([['DINNER', -40, 'Food'], ['DINNER', -40, 'Gifts']]);
  });

  it('can re-run a split rule sweep without re-splitting its own halves', async () => {
    const db = makeDb();
    await q.bootstrapSchema(db);
    const netflix = rule('netflix', [{ category: 'Subs', type: 'fixed', value: -8 }, { category: 'Gifts', type: 'fixed', value: -7.99 }]);
    await q.createRule(db, netflix);
    const [saved] = await q.getRules(db);
    await q.createTransaction(db, { date: '2026-03-03', description: 'NETFLIX', amount: -15.99, account: 'C', category: 'Subs' });
    expect(await q.executeRuleOnDatabase(db, saved)).toBe(3);
    await q.createTransaction(db, { date: '2026-04-03', description: 'NETFLIX', amount: -15.99, account: 'C', category: 'Subs' });
    expect(await q.executeRuleOnDatabase(db, saved)).toBe(3);
  });
});
