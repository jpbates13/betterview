import { describe, expect, it } from 'vitest';
import { csvFile, makeDb, visibleRows } from './testDb.js';
import {
  CsvMappingRequiredError, getImportBatches, importCsvToDatabase, parseAmount, parseDateToIso,
  saveCsvProfile, undoImportBatch,
} from '../src/csvImporter.js';

const FIDELITY = `Date,Description,Amount,Account
2026-01-05,COFFEE SHOP,-4.50,Visa
2026-01-05,COFFEE SHOP,-4.50,Visa
2026-01-06,PAYCHECK,2000,Visa
`;

describe('parsing', () => {
  it.each([
    ['1,234.56', 1234.56], ['(12.00)', -12], ['12.00-', -12], ['$5.00 CR', 5], ['5.00 DR', -5], ['', null], ['abc', null],
  ])('parseAmount(%s)', (raw, expected) => expect(parseAmount(raw)).toBe(expected));

  it('reads dates in the chosen order and rejects garbage', () => {
    expect(parseDateToIso('03/04/2026', 'MDY')).toBe('2026-03-04');
    expect(parseDateToIso('03/04/2026', 'DMY')).toBe('2026-04-03');
    expect(parseDateToIso('2026-03-04')).toBe('2026-03-04');
    expect(parseDateToIso('Mar 4, 2026')).toBe('2026-03-04');
    expect(parseDateToIso('13/13/2026', 'MDY')).toBeNull();
    expect(parseDateToIso('not a date')).toBeNull();
  });
});

describe('importing', () => {
  it('keeps genuine repeats in one file but skips them on re-import', async () => {
    const db = makeDb();
    const first = await importCsvToDatabase(csvFile(FIDELITY), db);
    expect(first.inserted).toBe(3);
    expect(visibleRows(db)).toHaveLength(3);

    const second = await importCsvToDatabase(csvFile(FIDELITY), db);
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(3);
    expect(visibleRows(db)).toHaveLength(3);
  });

  it('asks for a mapping for unknown formats, then imports with a saved profile', async () => {
    const db = makeDb();
    const bank = `Posted,Payee,Withdrawal,Deposit
04/03/2026,GROCER,25.00,
05/03/2026,REFUND,,10.00
bad,ROW,1,
`;
    await expect(importCsvToDatabase(csvFile(bank, 'bank.csv'), db)).rejects.toBeInstanceOf(CsvMappingRequiredError);

    const profile = {
      name: 'My bank', date: 'Posted', dateFormat: 'DMY', description: 'Payee', amount: null,
      debit: 'Withdrawal', credit: 'Deposit', account: null, defaultAccount: 'Checking',
      headers: ['Posted', 'Payee', 'Withdrawal', 'Deposit'],
    };
    await saveCsvProfile(db, profile);
    const summary = await importCsvToDatabase(csvFile(bank, 'bank.csv'), db);
    expect(summary.profileName).toBe('My bank');
    expect(summary.inserted).toBe(2);
    expect(summary.skipped).toEqual([{ line: 4, reason: 'unreadable date "bad"' }]);
    expect(db.raw.exec('SELECT date, amount, account FROM transactions ORDER BY id')[0].values).toEqual([
      ['2026-03-04', -25, 'Checking'],
      ['2026-03-05', 10, 'Checking'],
    ]);
  });

  it('undoes one import without touching others', async () => {
    const db = makeDb();
    const a = await importCsvToDatabase(csvFile(FIDELITY, 'a.csv'), db);
    await importCsvToDatabase(csvFile('Date,Description,Amount,Account\n2026-02-01,RENT,-1000,Visa\n', 'b.csv'), db);
    expect(await getImportBatches(db)).toHaveLength(2);

    const removed = await undoImportBatch(db, a.batchId);
    expect(removed).toBe(3);
    expect(visibleRows(db)).toEqual([['RENT', -1000, 'Uncategorized']]);
    expect(await getImportBatches(db)).toHaveLength(1);
  });
});
