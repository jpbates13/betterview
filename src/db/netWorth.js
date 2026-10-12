// Net worth history: totals pasted from Fidelity Full View (with their account detail)
// and figures entered by hand. One row per date.
import { saveDbToBrowser } from '../dbStorage.js';
import { bootstrapSchema } from '../dbQueries.js';
import { binds, inTransaction, queryRows, round2, toNumber } from './sql.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const toPoint = (row) => {
  let details = null;
  try {
    details = row.details ? JSON.parse(row.details) : null;
  } catch {
    details = null;
  }
  return {
    id: Number(row.id),
    date: row.date,
    netWorth: toNumber(row.net_worth),
    assets: row.assets === null ? null : toNumber(row.assets),
    liabilities: row.liabilities === null ? null : toNumber(row.liabilities),
    source: row.source === 'fidelity' ? 'fidelity' : 'manual',
    categories: details?.categories ?? [],
    accounts: details?.accounts ?? [],
  };
};

/** Every recorded point, oldest first. */
export async function getNetWorthHistory(db) {
  await bootstrapSchema(db);
  const rows = await queryRows(db, 'SELECT * FROM net_worth_history ORDER BY date;');
  return rows.map(toPoint);
}

const pastedOn = async (db, date) =>
  (await queryRows(db, "SELECT id FROM net_worth_history WHERE date = ? AND source = 'fidelity';", binds(date)))[0];

/** Saves a parsed Fidelity page, replacing whatever was recorded on its date. */
export async function saveNetWorthSnapshot(db, snapshot) {
  await bootstrapSchema(db);
  if (!ISO_DATE.test(snapshot?.date || '')) throw new Error('The snapshot has no date.');
  if (!Number.isFinite(snapshot.netWorth)) throw new Error('The snapshot has no net worth total.');
  const details = JSON.stringify({ categories: snapshot.categories ?? [], accounts: snapshot.accounts ?? [] });
  await db.exec(`
    INSERT INTO net_worth_history (date, net_worth, assets, liabilities, source, details)
    VALUES (?, ?, ?, ?, 'fidelity', ?)
    ON CONFLICT(date) DO UPDATE SET
      net_worth = excluded.net_worth, assets = excluded.assets, liabilities = excluded.liabilities,
      source = excluded.source, details = excluded.details;
  `, binds(snapshot.date, round2(snapshot.netWorth), snapshot.assets ?? null, snapshot.liabilities ?? null, details));
  await saveDbToBrowser(db);
}

/**
 * Records a hand-entered total. Passing `id` edits that point (and moves it if the date
 * changed). A date that already has a pasted Fidelity snapshot is left alone.
 */
export async function setNetWorthPoint(db, { id = null, date, netWorth }) {
  await bootstrapSchema(db);
  const value = toNumber(typeof netWorth === 'string' ? netWorth.replace(/[$,\s]/g, '') : netWorth, NaN);
  if (!ISO_DATE.test(date || '')) throw new Error('Enter the date.');
  if (!Number.isFinite(value)) throw new Error('Enter the net worth.');
  const pasted = await pastedOn(db, date);
  if (pasted && Number(pasted.id) !== Number(id)) {
    throw new Error(`${date} already has a pasted Fidelity snapshot. Delete it first to enter a figure by hand.`);
  }
  await inTransaction(db, async () => {
    if (id !== null) await db.exec('DELETE FROM net_worth_history WHERE id = ? AND date <> ?;', binds(id, date));
    await db.exec(`
      INSERT INTO net_worth_history (date, net_worth, source) VALUES (?, ?, 'manual')
      ON CONFLICT(date) DO UPDATE SET net_worth = excluded.net_worth, assets = NULL, liabilities = NULL,
        source = 'manual', details = NULL;
    `, binds(date, round2(value)));
  });
  await saveDbToBrowser(db);
}

/** Adds many hand-entered totals at once. Dates with a pasted snapshot keep it. */
export async function importNetWorthPoints(db, points) {
  await bootstrapSchema(db);
  const existing = new Map((await getNetWorthHistory(db)).map((p) => [p.date, p]));
  const result = { added: 0, updated: 0, keptSnapshots: 0 };
  await inTransaction(db, async () => {
    for (const { date, netWorth } of points) {
      if (!ISO_DATE.test(date || '') || !Number.isFinite(netWorth)) continue;
      const current = existing.get(date);
      if (current?.source === 'fidelity') {
        result.keptSnapshots += 1;
        continue;
      }
      await db.exec(`
        INSERT INTO net_worth_history (date, net_worth, source) VALUES (?, ?, 'manual')
        ON CONFLICT(date) DO UPDATE SET net_worth = excluded.net_worth;
      `, binds(date, round2(netWorth)));
      result[current ? 'updated' : 'added'] += 1;
    }
  });
  await saveDbToBrowser(db);
  return result;
}

export async function deleteNetWorthPoint(db, id) {
  await db.exec('DELETE FROM net_worth_history WHERE id = ?;', binds(id));
  await saveDbToBrowser(db);
}

/** The point closest to `daysBack` days before the latest one, for "change over" figures. */
export function pointBefore(history, daysBack) {
  if (history.length < 2) return null;
  const latest = history[history.length - 1];
  const target = new Date(`${latest.date}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() - daysBack);
  const targetIso = target.toISOString().slice(0, 10);
  // The latest point on or before the target, else the earliest point there is.
  const earlier = history.filter((p) => p.date <= targetIso);
  const found = earlier.length ? earlier[earlier.length - 1] : history[0];
  return found === latest ? null : found;
}
