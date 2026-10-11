import { saveDbToBrowser } from '../dbStorage.js';
import { resolveMerchant } from './merchants.js';
import { binds, inTransaction, normalizeText, queryRows } from './sql.js';

export async function getMerchantRules(db) {
  return queryRows(db, 'SELECT id, pattern, merchant FROM merchant_rules ORDER BY id;');
}

// Recomputes the merchant for every row (or only rows without one).
export async function refreshMerchants(db, { onlyMissing = false } = {}) {
  const rules = await getMerchantRules(db);
  const rows = await queryRows(
    db,
    `SELECT id, description, merchant FROM transactions ${onlyMissing ? 'WHERE merchant IS NULL' : ''};`,
  );
  const updates = rows
    .map((row) => ({ id: row.id, merchant: resolveMerchant(row.description, rules), current: row.merchant }))
    .filter((row) => row.merchant !== row.current);
  if (updates.length === 0) return 0;

  await inTransaction(db, async () => {
    for (const row of updates) {
      await db.exec('UPDATE transactions SET merchant = ? WHERE id = ?;', binds(row.merchant, row.id));
    }
  });
  return updates.length;
}

export async function addMerchantRule(db, { pattern, merchant }) {
  const cleanPattern = normalizeText(pattern);
  const cleanMerchant = normalizeText(merchant);
  if (!cleanPattern || !cleanMerchant) throw new Error('Enter both the text to match and the merchant name.');
  await db.exec('INSERT INTO merchant_rules (pattern, merchant) VALUES (?, ?);', binds(cleanPattern, cleanMerchant));
  await refreshMerchants(db);
  await saveDbToBrowser(db);
}

export async function deleteMerchantRule(db, ruleId) {
  await db.exec('DELETE FROM merchant_rules WHERE id = ?;', binds(ruleId));
  await refreshMerchants(db);
  await saveDbToBrowser(db);
}
