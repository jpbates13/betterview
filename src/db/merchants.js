import { normalizeLower, normalizeText } from './sql.js';

// Payment-processor prefixes that card statements put in front of the real merchant.
const PROCESSOR_PREFIXES = [
  /^sq\s*\*\s*/i,
  /^tst\s*\*\s*/i,
  /^sp\s*\*?\s+/i,
  /^paypal\s*\*\s*/i,
  /^pp\s*\*\s*/i,
  /^py\s*\*\s*/i,
  /^dd\s*\*?\s*doordash\s*/i,
  /^pos\s+(purchase|debit)?\s*/i,
  /^debit\s+card\s+purchase\s*-?\s*/i,
  /^purchase\s+authorized\s+on\s+\d{1,2}\/\d{1,2}\s*/i,
  /^recurring\s+(payment|debit)\s*-?\s*/i,
  /^ach\s+(debit|credit)\s*-?\s*/i,
];

const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';

const toTitleCase = (value) => value
  .toLowerCase()
  .replace(/(^|[\s\-'&/(])([a-z])/g, (_m, p, c) => p + c.toUpperCase())
  .replace(/\b(Llc|Inc|Co)\b/g, (word) => word.toUpperCase());

// Best-effort cleanup of a raw statement description into a merchant name,
// e.g. "SQ *BLUE BOTTLE COFFEE #1234 SAN FRANCISCO CA" -> "Blue Bottle Coffee".
export function cleanMerchantName(description) {
  let text = normalizeText(description);
  if (!text) return '';

  for (const prefix of PROCESSOR_PREFIXES) {
    text = text.replace(prefix, '');
  }

  text = text
    // Trailing "CITY ST" / "ST" location suffixes.
    .replace(new RegExp(`\\s+[A-Za-z .'-]{2,}\\s+(${US_STATES})$`), '')
    .replace(new RegExp(`\\s+(${US_STATES})$`), '')
    // Store numbers, reference numbers, phone numbers and card masks.
    .replace(/\s*#\s*\d+.*$/, '')
    .replace(/\s+x{2,}\d+.*$/i, '')
    .replace(/\s+\d{3}[-.]?\d{3}[-.]?\d{4}.*$/, '')
    .replace(/\s+\d{4,}.*$/, '')
    .replace(/\s*\*\s*[A-Z0-9]{6,}$/i, '')
    .replace(/[*]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return toTitleCase(text || normalizeText(description));
}

// User-defined merchant rules win; otherwise fall back to the automatic cleanup.
export function resolveMerchant(description, merchantRules = []) {
  const haystack = normalizeLower(description);
  for (const rule of merchantRules) {
    const pattern = normalizeLower(rule.pattern);
    if (pattern && haystack.includes(pattern)) {
      return normalizeText(rule.merchant);
    }
  }
  return cleanMerchantName(description);
}
