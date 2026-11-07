import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import { csvFile, makeDb } from './testDb.js';
import { importCsvToDatabase } from '../src/csvImporter.js';
import { getTransactions } from '../src/dbQueries.js';
import { exportFileName, transactionsToCsv } from '../src/transactionsCsv.js';

const tx = (over) => ({
  id: 1, date: '2026-10-09', description: 'MBTA', amount: -2.4, account: 'Venture X', category: 'Transit',
  source_file: 'oct.csv', manual_override: null, split_parent_id: null, merchant: null, import_batch_id: null,
  reimburses_id: null, applied_rule_id: null, applied_rule_name: null, tags: [], is_excluded: false, is_split: false,
  ...over,
});

const parse = (csv) => Papa.parse(csv.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data;

describe('transactionsToCsv', () => {
  it('writes one row per transaction with readable status, tags and quoting', () => {
    const rows = parse(transactionsToCsv([
      tx({ description: 'LUNCH, "DELI"', tags: ['work', 'reimbursable'], applied_rule_name: 'Food' }),
      tx({ id: 2, amount: 1500, category: 'Income' }),
      tx({ id: 3, amount: 20, category: 'Dining', is_excluded: true, is_split: true }),
    ]));
    expect(rows[0]).toMatchObject({ Description: 'LUNCH, "DELI"', Amount: '-2.4', Status: 'Expense', Tags: 'work; reimbursable', Rule: 'Food', ID: '1' });
    expect(rows[1]).toMatchObject({ Status: 'Income', Amount: '1500' });
    expect(rows[2]).toMatchObject({ Status: 'Excluded', Split: 'Yes' });
  });

  it('keeps spreadsheet formulas from running but leaves numbers alone', () => {
    const [row] = parse(transactionsToCsv([tx({ description: '=HYPERLINK("x")', merchant: '-5' , category: '@cat' })]));
    expect(row.Description).toBe(`'=HYPERLINK("x")`);
    expect(row.Merchant).toBe('-5');
    expect(row.Category).toBe("'@cat");
    expect(row.Amount).toBe('-2.4');
  });

  it('writes just the header for an empty export', () => {
    expect(parse(transactionsToCsv([]))).toEqual([]);
    expect(transactionsToCsv([])).toContain('Date,Description,Amount,Account,Category');
  });

  it('can be imported again without a column mapping', async () => {
    const source = makeDb();
    await importCsvToDatabase(csvFile('Date,Description,Amount,Account,Category\n2026-01-05,COFFEE,-4.50,Visa,Dining\n2026-01-06,PAYCHECK,2000,Visa,Income\n'), source);
    const exported = transactionsToCsv(await getTransactions(source));

    const target = makeDb();
    const summary = await importCsvToDatabase(csvFile(exported, 'export.csv'), target);
    expect(summary.inserted).toBe(2);
    const strip = (rows) => rows.map(({ date, description, amount, account, category }) => ({ date, description, amount, account, category }));
    expect(strip(await getTransactions(target))).toEqual(strip(await getTransactions(source)));
  });
});

describe('exportFileName', () => {
  it('dates the file and names the scope', () => {
    const day = new Date(2026, 10, 7);
    expect(exportFileName('all', day)).toBe('betterview-transactions-2026-11-07.csv');
    expect(exportFileName('filtered', day)).toBe('betterview-transactions-filtered-2026-11-07.csv');
  });
});
