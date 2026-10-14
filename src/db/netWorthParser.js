// Parses text copied from Fidelity Full View's Net worth page and pasted lists of
// historical net worth figures. Pure functions: no database access.
import { parseAmount, parseDateToIso } from '../csvImporter.js';
import { round2 } from './sql.js';

const MONEY = String.raw`[-−]?\s?\$\s?[\d,]+(?:\.\d{1,2})?`;
const moneyValue = (text) => parseAmount(String(text).replace(/\s/g, ''));

// How fresh Fidelity says a balance is: "Just now", "7 hours ago", or a date for manual entries.
const UPDATED_AT_END = /\s*(Just now|\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago|\d{1,2}\/\d{1,2}\/\d{4})$/i;

// Section ends: everything after these is links and disclaimers.
const END_OF_ACCOUNTS = /^(Hidden accounts|Edit non-Fidelity accounts|Download summary|Did you find this page helpful)/i;

const cleanLines = (text) => String(text || '')
  .replace(/\r\n?/g, '\n')
  .split('\n')
  .map((line) => line.replace(/[\u00a0\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim());

/**
 * Reads the Net worth page. Returns null when the text doesn't look like that page.
 *
 * Fidelity's copy puts each account on two lines:
 *   "Venture X-$30.00CreditCard2 days ago"   name, balance, type (with last 4), last updated
 *   "Capital One - via Direct Web API"        institution
 * and each group or category on one line with nothing after the total ("Loans -$233,191.00").
 */
export function parseFidelityNetWorth(text, { today } = {}) {
  const lines = cleanLines(text);

  let asOf = null;
  let netWorth = null;
  for (let i = 0; i < lines.length; i += 1) {
    const asOfMatch = lines[i].match(/^As of\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (asOfMatch && !asOf) asOf = parseDateToIso(asOfMatch[1], 'MDY');
    if (netWorth === null && /^Net worth$/i.test(lines[i])) {
      const next = lines.slice(i + 1, i + 3).find((line) => new RegExp(`^${MONEY}$`).test(line));
      if (next) netWorth = moneyValue(next);
    }
  }

  const groupHeader = new RegExp(`^(Assets|Liabilities)\\s*(${MONEY})$`, 'i');
  const totalLine = new RegExp(`^([^$]*[A-Za-z][^$]*?)\\s*(${MONEY})$`);
  const accountLine = new RegExp(`^(.*?[A-Za-z0-9)].*?)\\s*(${MONEY})(.*)$`);

  const totals = { assets: null, liabilities: null };
  const categories = [];
  const accounts = [];
  let group = null;
  let category = null;
  let lastAccount = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    if (group && END_OF_ACCOUNTS.test(line)) break;

    const header = line.match(groupHeader);
    if (header) {
      group = header[1].toLowerCase() === 'assets' ? 'asset' : 'liability';
      totals[group === 'asset' ? 'assets' : 'liabilities'] = moneyValue(header[2]);
      category = null;
      lastAccount = null;
      continue;
    }
    if (!group) continue;

    // Category breakdown at the top of a group: "Investments" then "$275,941.2343.73%".
    if (/%$/.test(line)) continue;

    const total = line.match(totalLine);
    if (total) {
      category = total[1].trim();
      categories.push({ group, name: category, total: moneyValue(total[2]) });
      lastAccount = null;
      continue;
    }

    const unavailable = line.match(/^(.+?)\s*Access balance info$/i);
    const account = unavailable ? null : line.match(accountLine);
    if (account || unavailable) {
      const name = (unavailable ? unavailable[1] : account[1]).trim();
      let rest = unavailable ? '' : account[3].trim();
      // An account without a balance has its type on the next non-blank line.
      if (unavailable) {
        const next = lines.slice(i + 1).findIndex(Boolean);
        if (next >= 0 && UPDATED_AT_END.test(lines[i + 1 + next])) {
          rest = lines[i + 1 + next];
          i += 1 + next;
        }
      }
      const updatedMatch = rest.match(UPDATED_AT_END);
      const type = (updatedMatch ? rest.slice(0, updatedMatch.index) : rest).trim();
      const lastDigits = type.match(/\s-\s*(\d{3,4})$/);
      lastAccount = {
        group,
        category: category || (group === 'asset' ? 'Assets' : 'Liabilities'),
        name,
        balance: unavailable ? null : moneyValue(account[2]),
        type: lastDigits ? type.slice(0, lastDigits.index).trim() : type,
        mask: lastDigits ? lastDigits[1] : '',
        updated: updatedMatch ? updatedMatch[1] : '',
        institution: '',
      };
      accounts.push(lastAccount);
      continue;
    }

    // The line under an account names its institution. Anything else ("OtherIs anything
    // missing?", "Add other items") is page furniture.
    if (lastAccount && !lastAccount.institution) {
      lastAccount.institution = line;
      lastAccount = null;
    }
  }

  if (accounts.length === 0 && netWorth === null) return null;

  const sum = (g) => round2(accounts.filter((a) => a.group === g).reduce((acc, a) => acc + (a.balance ?? 0), 0));
  const assets = totals.assets ?? sum('asset');
  const liabilities = totals.liabilities ?? sum('liability');
  const resolvedNetWorth = netWorth ?? round2(assets + liabilities);

  const warnings = [];
  if (!asOf) warnings.push('No "As of" date found; using today.');
  if (accounts.length === 0) warnings.push('No account lines found; only the total will be saved.');
  if (totals.assets !== null && accounts.length > 0 && Math.abs(sum('asset') - totals.assets) > 0.01) {
    warnings.push(`Asset accounts add up to ${sum('asset').toFixed(2)}, but the page says ${totals.assets.toFixed(2)}.`);
  }
  if (totals.liabilities !== null && accounts.length > 0 && Math.abs(sum('liability') - totals.liabilities) > 0.01) {
    warnings.push(`Liability accounts add up to ${sum('liability').toFixed(2)}, but the page says ${totals.liabilities.toFixed(2)}.`);
  }
  if (Math.abs(round2(assets + liabilities) - resolvedNetWorth) > 0.01) {
    warnings.push(`Assets minus liabilities is ${round2(assets + liabilities).toFixed(2)}, but the page says ${resolvedNetWorth.toFixed(2)}.`);
  }

  return {
    date: asOf || today || new Date().toISOString().slice(0, 10),
    netWorth: resolvedNetWorth,
    assets,
    liabilities,
    categories,
    accounts,
    warnings,
  };
}

const DATE_PATTERNS = [
  /\b\d{4}-\d{1,2}-\d{1,2}\b/,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
  /\b[A-Za-z]{3,9}\.?[\s-]+\d{1,2}(?:st|nd|rd|th)?,?[\s-]+\d{4}\b/,
  /\b\d{1,2}[\s-]+[A-Za-z]{3,9}\.?,?[\s-]+\d{4}\b/,
];

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Month-only dates, as monthly charts label them ("Jan 2023", "January '23", "01/2023",
// "2023-01"). They count as the last day of that month.
const MONTH_PATTERNS = [
  { pattern: /\b([A-Za-z]{3,9})\.?,?\s+'?(\d{4}|\d{2})\b/, month: (m) => MONTH_NAMES.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, year: (m) => m[2] },
  { pattern: /\b(\d{1,2})\/(\d{4})\b/, month: (m) => Number(m[1]), year: (m) => m[2] },
  { pattern: /\b(\d{4})-(\d{1,2})\b/, month: (m) => Number(m[2]), year: (m) => m[1] },
];

const monthEnd = (year, month) => {
  const y = Number(String(year).length === 2 ? `20${year}` : year);
  if (!(month >= 1 && month <= 12) || y < 1900) return null;
  return new Date(Date.UTC(y, month, 0)).toISOString().slice(0, 10);
};

const findDate = (line) => {
  const without = (match) => line.slice(0, match.index) + ' ' + line.slice(match.index + match[0].length);
  for (const pattern of DATE_PATTERNS) {
    const match = line.match(pattern);
    if (!match) continue;
    const iso = parseDateToIso(match[0]);
    if (iso) return { iso, rest: without(match) };
  }
  for (const { pattern, month, year } of MONTH_PATTERNS) {
    const match = line.match(pattern);
    if (!match) continue;
    const iso = monthEnd(year(match), month(match));
    if (iso) return { iso, rest: without(match) };
  }
  return null;
};

// "$250K" and "$1.2M", as chart labels abbreviate.
const scaledValue = (raw) => {
  const suffix = raw.match(/([kKmM])$/);
  const value = moneyValue(suffix ? raw.slice(0, -1) : raw);
  if (value === null || !suffix) return value;
  return value * (suffix[1].toLowerCase() === 'k' ? 1e3 : 1e6);
};

const findValue = (text) => {
  const match = text.match(/\(?[-−]?\s?\$?\s?\d[\d,]*(?:\.\d+)?\)?(?:\s?[kKmM]\b)?/g);
  if (!match) return null;
  // The largest-looking figure on the line is the balance, not a stray day or percent.
  const values = match.map((m) => scaledValue(m.replace(/\s/g, ''))).filter((v) => v !== null && Number.isFinite(v));
  if (values.length === 0) return null;
  return values.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best));
};

/**
 * Reads pasted history: one date and one figure per line ("10/12/2026 $397,784.74",
 * "2026-10-12,397784.74", "Oct 12, 2026\t$397,784.74", "Jan 2023 $250K"), or a date line followed by its
 * figure on the next line, as a copied table often comes out.
 */
export function parseNetWorthHistory(text) {
  const fromJson = parseHistoryJson(text);
  if (fromJson) return fromJson;

  let lines = cleanLines(text).filter(Boolean);
  // A copied Credit Karma page carries just the chart point under the pointer (between the
  // totals and the range buttons); everything after it is spending and transactions.
  const isCreditKarma = /Credit Karma/i.test(text) && lines.includes('30D');
  if (isCreditKarma) {
    const start = lines.findIndex((line) => /^Net worth$/i.test(line));
    lines = lines.slice(start + 1, lines.indexOf('30D'));
  }
  const byDate = new Map();
  const skipped = [];
  let pendingDate = null;

  // Statements with a column per year ("2025 2024 2023") and an "Ending Balance" row give
  // year-end balances.
  let years = null;
  const yearEndLines = new Set();
  lines.forEach((line, index) => {
    if (/^(\d{4})(\s+\d{4})*$/.test(line)) {
      years = line.split(/\s+/);
      return;
    }
    if (!years || !/^Ending Balance\b/i.test(line)) return;
    const amounts = line.match(new RegExp(MONEY, 'g')) ?? [];
    if (amounts.length !== years.length) return;
    years.forEach((year, i) => byDate.set(`${year}-12-31`, round2(moneyValue(amounts[i]))));
    yearEndLines.add(index);
    years = null;
  });

  for (const [index, line] of lines.entries()) {
    if (yearEndLines.has(index) || /^(\d{4})(\s+\d{4})*$/.test(line)) continue;
    const date = findDate(line);
    if (date) {
      const value = findValue(date.rest);
      if (value !== null) {
        byDate.set(date.iso, round2(value));
        pendingDate = null;
      } else {
        if (pendingDate) skipped.push(pendingDate.line);
        pendingDate = { iso: date.iso, line };
      }
      continue;
    }
    // Only a line that is just an amount belongs to the date above it.
    const value = /^\(?[-−]?\s?\$?\s?\d[\d,]*(\.\d+)?\)?(\s?[kKmM])?$/.test(line) ? findValue(line) : null;
    if (pendingDate && value !== null) {
      byDate.set(pendingDate.iso, round2(value));
      pendingDate = null;
    } else if (/\d/.test(line)) {
      skipped.push(line);
    }
  }
  if (pendingDate) skipped.push(pendingDate.line);

  const points = [...byDate.entries()]
    .map(([date, netWorth]) => ({ date, netWorth }))
    .sort((a, b) => a.date.localeCompare(b.date));
  // The page's totals and axis labels aren't rows anyone meant to import.
  return { points, skipped: isCreditKarma ? [] : skipped };
}

// ── JSON, as a site's own chart data comes back in the browser's Network tab ──

const VALUE_KEY = /net.?worth|value|amount|balance|total|y$/i;

// Seconds or milliseconds since 1970 between 1990 and 2100, or a date string.
const toIsoDate = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e11 ? value : value > 6e8 && value < 4.2e9 ? value * 1000 : NaN;
    if (!Number.isFinite(ms)) return null;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
  if (/^\d{10,13}$/.test(value)) return toIsoDate(Number(value));
  return parseDateToIso(value) ?? findDate(value)?.iso ?? null;
};

const toAmount = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^[-−]?\$?[\d,]+(\.\d+)?$/.test(value.trim())) return moneyValue(value);
  return null;
};

// { date, netWorth: { amount: 1 } } → { date, 'netWorth.amount': 1 }
const flatten = (row, prefix = '', depth = 0, out = {}) => {
  for (const [key, value] of Object.entries(row)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value) && depth < 2) flatten(value, path, depth + 1, out);
    else out[path] = value;
  }
  return out;
};

const pointsFromArray = (array) => {
  // [[timestamp, value], ...]
  if (array.every((item) => Array.isArray(item) && item.length >= 2)) {
    const points = array.map(([d, v]) => ({ date: toIsoDate(d), netWorth: toAmount(v) }));
    return points.every((p) => p.date && p.netWorth !== null) ? points : [];
  }
  if (!array.every((item) => item && typeof item === 'object' && !Array.isArray(item))) return [];
  const rows = array.map((item) => flatten(item));
  const keys = Object.keys(rows[0]);
  const dateKey = keys.find((key) => rows.every((row) => toIsoDate(row[key])));
  if (!dateKey) return [];
  const numericKeys = keys.filter((key) => key !== dateKey && rows.every((row) => toAmount(row[key]) !== null));
  if (numericKeys.length === 0) return [];
  const valueKey = numericKeys.find((key) => /net.?worth/i.test(key))
    ?? numericKeys.find((key) => VALUE_KEY.test(key.split('.').pop()))
    ?? numericKeys[0];
  const points = rows.map((row) => ({ date: toIsoDate(row[dateKey]), netWorth: toAmount(row[valueKey]) }));
  points.isNetWorth = /net.?worth/i.test(valueKey);
  return points;
};

/**
 * Finds the longest series of dated figures anywhere in pasted JSON. Returns null when the
 * text isn't JSON or holds no such series.
 */
export function parseHistoryJson(text) {
  const trimmed = String(text || '').trim();
  if (!/^[[{]/.test(trimmed)) return null;
  let data;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return null;
  }
  // A series named for net worth beats a longer one that isn't (such as transactions).
  let best = [];
  const beats = (points) => (Boolean(points.isNetWorth) !== Boolean(best.isNetWorth)
    ? Boolean(points.isNetWorth)
    : points.length > best.length);
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 12) return;
    if (Array.isArray(node)) {
      if (node.length > 0) {
        const points = pointsFromArray(node);
        if (points.length > 0 && beats(points)) best = points;
      }
      node.forEach((child) => visit(child, depth + 1));
    } else {
      Object.values(node).forEach((child) => visit(child, depth + 1));
    }
  };
  visit(data, 0);
  if (best.length === 0) return null;
  // One figure per day; the last one listed for a day wins.
  const byDate = new Map(best.map((p) => [p.date, round2(p.netWorth)]));
  const points = [...byDate.entries()]
    .map(([date, netWorth]) => ({ date, netWorth }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { points, skipped: [] };
}
