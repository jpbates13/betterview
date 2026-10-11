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

  it.each([
    ['2026-10-09T00:00:00Z'], ['2026-10-09T00:00:00.000-04:00'], ['10/09/2026 12:00:00 AM'], ['Oct-09-2026'],
    ['09-Oct-2026'], ['09-Oct-26'], ['Friday, October 9, 2026'], ['October 9th, 2026'], ['20261009'], ['="10/09/2026"'],
  ])('reads the export date %s', (raw) => {
    expect(parseDateToIso(raw)).toBe('2026-10-09');
  });

  it('reads typographic minus signs and currency suffixes', () => {
    expect(parseAmount('\u22122.40')).toBe(-2.4);
    expect(parseAmount('$-2.40')).toBe(-2.4);
    expect(parseAmount('2.40 USD')).toBe(2.4);
  });
});

describe('importing', () => {
  it('imports a Fidelity spending export with Mon-DD-YYYY dates, title line and footer', async () => {
    const db = makeDb();
    const csv = `\uFEFFSpending Transactions: \r
"Date","Description","Amount (in $)","Account Name","Transaction Type","Category","Subcategory","Hidden Transaction"
"Oct-09-2026","MBTA","-2.4","Venture X","Expenses","Auto & transport","Public transit","No"
"Oct-09-2026","MBTA","-2.4","Venture X","Expenses","Auto & transport","Public transit","No"
"Oct-07-2026","ELECTRONIC PAYMENT","70.71","Venture X","Transfers","Transfers","Credit card payment","No"

"Date downloaded 10/11/2026  4:37 PM"

"1099065.2.0"
`;
    const summary = await importCsvToDatabase(csvFile(csv, 'Transactions_Oct-11-2026 at 4.37.39 PM.csv'), db);
    expect(summary.profileName).toBe('Fidelity (built-in)');
    expect(summary.skipped).toEqual([]);
    expect(summary.inserted).toBe(3);
    expect(visibleRows(db, "description = 'MBTA'")).toEqual([['MBTA', -2.4, 'Auto & transport'], ['MBTA', -2.4, 'Auto & transport']]);
    const again = await importCsvToDatabase(csvFile(csv, 'again.csv'), db);
    expect([again.inserted, again.duplicates]).toEqual([0, 3]);
  });

  it('imports a Fidelity Full View export with timestamped dates', async () => {
    const db = makeDb();
    const csv = `"Date","Account","Description","Category","Tags","Amount"
"2026-10-07T00:00:00","Venture X","MBTA","Auto & transport","","-2.40"
"2026-10-07T00:00:00","Venture X","MBTA","Auto & transport","","-2.40"
"2026-10-06T00:00:00","Cash Management","DIRECT DEPOSIT VENMO CASHOUT","Cash & ATM","","35.00"
`;
    const summary = await importCsvToDatabase(csvFile(csv, 'Transactions_Oct-11-2026 at 4.34.02 PM.csv'), db);
    expect(summary.profileName).toBe('Fidelity (built-in)');
    expect(summary.skipped).toEqual([]);
    expect(summary.inserted).toBe(3);
    expect(visibleRows(db, "description = 'MBTA'")).toHaveLength(2);
  });

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

  it('recovers a same-day repeat that an older version dropped when the file is re-imported', async () => {
    const db = makeDb();
    // Older imports kept only one of two identical rows.
    await importCsvToDatabase(csvFile('Date,Description,Amount,Account\n2026-10-07,MBTA,-2.40,Visa\n', 'old.csv'), db);
    const again = await importCsvToDatabase(csvFile('Date,Description,Amount,Account\n2026-10-07,MBTA,-2.40,Visa\n2026-10-07,MBTA,-2.40,Visa\n', 'full.csv'), db);
    expect(again.inserted).toBe(1);
    expect(again.duplicates).toBe(1);
    expect(visibleRows(db)).toHaveLength(2);
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
