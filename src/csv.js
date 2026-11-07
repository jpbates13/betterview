import Papa from 'papaparse';

// Spreadsheets run a cell that starts with = + - @ as a formula. Text from a bank
// file shouldn't, so it gets a leading apostrophe; plain numbers are left alone.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;
const safeText = (value) => {
  const text = String(value ?? '');
  return FORMULA_START.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
};

/** A CSV file for spreadsheets: formula-safe text, CRLF lines, and a UTF-8 byte order mark for Excel. */
export function toCsv(fields, rows) {
  const data = rows.map((row) => row.map((value) => (typeof value === 'number' ? value : safeText(value))));
  return `\uFEFF${Papa.unparse({ fields, data }, { newline: '\r\n' })}\r\n`;
}

/** Today's local date as YYYY-MM-DD, for file names. */
export function dateStamp(today = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}
