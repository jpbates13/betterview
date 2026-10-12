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

const findDate = (line) => {
  for (const pattern of DATE_PATTERNS) {
    const match = line.match(pattern);
    if (!match) continue;
    const iso = parseDateToIso(match[0]);
    if (iso) return { iso, rest: line.slice(0, match.index) + ' ' + line.slice(match.index + match[0].length) };
  }
  return null;
};

const findValue = (text) => {
  const match = text.match(/\(?[-−]?\s?\$?\s?\d[\d,]*(?:\.\d+)?\)?/g);
  if (!match) return null;
  // The largest-looking figure on the line is the balance, not a stray day or percent.
  const values = match.map((m) => moneyValue(m)).filter((v) => v !== null && Number.isFinite(v));
  if (values.length === 0) return null;
  return values.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best));
};

/**
 * Reads pasted history: one date and one figure per line ("10/12/2026 $397,784.74",
 * "2026-10-12,397784.74", "Oct 12, 2026\t$397,784.74"), or a date line followed by its
 * figure on the next line, as a copied table often comes out.
 */
export function parseNetWorthHistory(text) {
  const lines = cleanLines(text).filter(Boolean);
  const byDate = new Map();
  const skipped = [];
  let pendingDate = null;

  for (const line of lines) {
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
    const value = findValue(line);
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
  return { points, skipped };
}
