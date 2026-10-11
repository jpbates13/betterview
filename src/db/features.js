// Budgets, tags, reimbursements, recurring charges, net worth and yearly summaries.
import { saveDbToBrowser } from '../dbStorage.js';
import { bootstrapSchema, getAnalyticsInclusionSql, getAnalyticsSql, getCategoryNetSpending } from '../dbQueries.js';
import { binds, changes, inTransaction, normalizeText, placeholders, queryRows, round2, toNumber } from './sql.js';

const monthBounds = (month) => {
  const [year, monthIndex] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}`, days: lastDay };
};

// ── Tags ─────────────────────────────────────────────────────────────────────

export const normalizeTag = (tag) => normalizeText(tag).toLowerCase().replace(/\s+/g, '-').replace(/,/g, '');

export async function setTransactionTags(db, transactionId, tags) {
  const clean = [...new Set((tags || []).map(normalizeTag).filter(Boolean))];
  await inTransaction(db, async () => {
    await db.exec('DELETE FROM transaction_tags WHERE transaction_id = ?;', binds(transactionId));
    for (const tag of clean) {
      await db.exec('INSERT INTO transaction_tags (transaction_id, tag) VALUES (?, ?);', binds(transactionId, tag));
    }
  });
  await saveDbToBrowser(db);
  return clean;
}

export async function addTagToTransactions(db, transactionIds, tag) {
  const clean = normalizeTag(tag);
  if (!clean || transactionIds.length === 0) return 0;
  await inTransaction(db, async () => {
    for (const id of transactionIds) {
      await db.exec('INSERT OR IGNORE INTO transaction_tags (transaction_id, tag) VALUES (?, ?);', binds(id, clean));
    }
  });
  await saveDbToBrowser(db);
  return transactionIds.length;
}

export async function removeTagFromTransactions(db, transactionIds, tag) {
  if (transactionIds.length === 0) return;
  await db.exec(
    `DELETE FROM transaction_tags WHERE tag = ? AND transaction_id IN (${placeholders(transactionIds.length)});`,
    binds(normalizeTag(tag), ...transactionIds),
  );
  await saveDbToBrowser(db);
}

// Every tag with how many visible rows carry it and their net total.
export async function getTagSummary(db, { startDate, endDate } = {}) {
  await bootstrapSchema(db);
  const params = [];
  let dateSql = '';
  if (startDate) { dateSql += ' AND t.date >= ?'; params.push(startDate); }
  if (endDate) { dateSql += ' AND t.date <= ?'; params.push(endDate); }
  const rows = await queryRows(db, `
    SELECT tt.tag, COUNT(*) AS count, COALESCE(SUM(t.amount), 0) AS total
    FROM transaction_tags tt
    JOIN transactions t ON t.id = tt.transaction_id AND t.is_hidden = 0
    WHERE 1 = 1 ${dateSql}
    GROUP BY tt.tag
    ORDER BY tt.tag;
  `, params);
  return rows.map((row) => ({ tag: row.tag, count: Number(row.count), total: round2(row.total) }));
}

// ── Bulk edits ───────────────────────────────────────────────────────────────

const assertNoSplitHalves = async (db, ids) => {
  const halves = await queryRows(
    db,
    `SELECT id FROM transactions WHERE split_parent_id IS NOT NULL AND id IN (${placeholders(ids.length)});`,
    binds(...ids),
  );
  if (halves.length > 0) {
    throw new Error('The selection includes split halves. Undo those splits before changing them.');
  }
};

export async function bulkSetCategory(db, transactionIds, category) {
  const clean = normalizeText(category);
  if (!clean) throw new Error('Enter a category.');
  if (transactionIds.length === 0) return 0;
  // Split halves keep their category until the split is undone.
  await db.exec(
    `UPDATE transactions SET category = ?, applied_rule_id = NULL
     WHERE id IN (${placeholders(transactionIds.length)}) AND split_parent_id IS NULL;`,
    binds(clean, ...transactionIds),
  );
  const updated = await changes(db);
  await saveDbToBrowser(db);
  return updated;
}

export async function bulkSetOverride(db, transactionIds, overrideStatus) {
  if (transactionIds.length === 0) return 0;
  await db.exec(
    `UPDATE transactions SET manual_override = ? WHERE id IN (${placeholders(transactionIds.length)});`,
    binds(overrideStatus, ...transactionIds),
  );
  await saveDbToBrowser(db);
  return transactionIds.length;
}

export async function bulkDelete(db, transactionIds) {
  if (transactionIds.length === 0) return 0;
  await assertNoSplitHalves(db, transactionIds);
  const list = placeholders(transactionIds.length);
  await inTransaction(db, async () => {
    await db.exec(`DELETE FROM transaction_tags WHERE transaction_id IN (${list});`, binds(...transactionIds));
    await db.exec(`UPDATE transactions SET reimburses_id = NULL WHERE reimburses_id IN (${list});`, binds(...transactionIds));
    await db.exec(`DELETE FROM transactions WHERE id IN (${list});`, binds(...transactionIds));
  });
  await saveDbToBrowser(db);
  return transactionIds.length;
}

// ── Reimbursements ───────────────────────────────────────────────────────────

export const REIMBURSABLE_TAG = 'reimbursable';

// Links a refund/reimbursement (positive row) to the expense it pays back, or unlinks it.
export async function linkReimbursement(db, reimbursementId, expenseId) {
  const [reimbursement] = await queryRows(db, 'SELECT id, amount FROM transactions WHERE id = ?;', binds(reimbursementId));
  if (!reimbursement) throw new Error('Reimbursement not found.');
  if (expenseId !== null) {
    if (toNumber(reimbursement.amount) <= 0) throw new Error('Only incoming money can be linked as a reimbursement.');
    const [expense] = await queryRows(db, 'SELECT id, amount FROM transactions WHERE id = ?;', binds(expenseId));
    if (!expense || toNumber(expense.amount) >= 0) throw new Error('Pick an expense to link this reimbursement to.');
  }
  await db.exec('UPDATE transactions SET reimburses_id = ? WHERE id = ?;', binds(expenseId, reimbursementId));
  await saveDbToBrowser(db);
}

// Expenses tagged "reimbursable", with how much has been paid back so far.
export async function getReimbursementStatus(db) {
  await bootstrapSchema(db);
  const rows = await queryRows(db, `
    SELECT t.id, t.date, t.description, t.amount, t.category,
           COALESCE((SELECT SUM(r.amount) FROM transactions r WHERE r.reimburses_id = t.id AND r.is_hidden = 0), 0) AS repaid
    FROM transactions t
    JOIN transaction_tags tt ON tt.transaction_id = t.id AND tt.tag = ?
    WHERE t.is_hidden = 0
    ORDER BY t.date DESC;
  `, binds(REIMBURSABLE_TAG));
  return rows.map((row) => {
    const owed = round2(Math.abs(toNumber(row.amount)) - toNumber(row.repaid));
    return { ...row, repaid: round2(row.repaid), outstanding: Math.max(owed, 0), isSettled: owed <= 0.005 };
  });
}

// Credits linked to one expense.
export async function getLinkedReimbursements(db, expenseId) {
  return queryRows(db, `
    SELECT id, date, description, amount FROM transactions
    WHERE reimburses_id = ? AND is_hidden = 0 ORDER BY date;
  `, binds(expenseId));
}

const SPLIT_SHARES = [2, 3, 4, 5, 6];
const SPLIT_WINDOW_DAYS = 45;

/**
 * Likely expenses for an unlinked credit: earlier expenses (up to `days` before it, or a
 * few days after) that still have room to be paid back, ranked by how well the amount
 * fits (the whole bill, or an even share of it for split bills), a "reimbursable" tag,
 * the same category, and closeness in time. Each has a short reason.
 */
export async function suggestReimbursementLinks(db, creditId, { days = 120, limit = 5 } = {}) {
  const [credit] = await queryRows(db, 'SELECT id, date, amount, category FROM transactions WHERE id = ?;', binds(creditId));
  if (!credit || toNumber(credit.amount) <= 0) return [];
  const creditAmount = toNumber(credit.amount);
  const { includedConditionSql, reimbursementExcludedCategoriesSql } = await getAnalyticsSql(db);

  const candidates = await queryRows(db, `
    SELECT t.id, t.date, t.description, t.amount, t.category,
           COALESCE((SELECT SUM(r.amount) FROM transactions r WHERE r.reimburses_id = t.id AND r.is_hidden = 0), 0) AS repaid,
           EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag = ?) AS is_reimbursable
    -- Only real spending: not transfers, card payments or rows excluded from analytics.
    FROM (
      SELECT * FROM transactions
      WHERE is_hidden = 0 AND amount < 0 AND ${includedConditionSql}
        AND LOWER(COALESCE(category, '')) NOT IN ${reimbursementExcludedCategoriesSql}
    ) t
    WHERE t.date BETWEEN date(?, ?) AND date(?, '+7 days')
      AND -t.amount >= ? * 0.95;
  `, binds(REIMBURSABLE_TAG, credit.date, `-${days} days`, credit.date, creditAmount));

  const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance + 1e-9;
  const scored = candidates.map((row) => {
    const expense = -toNumber(row.amount);
    const room = round2(expense - toNumber(row.repaid));
    if (room < creditAmount * 0.95) return null;
    const age = Math.abs(Date.parse(`${credit.date}T00:00:00Z`) - Date.parse(`${row.date}T00:00:00Z`)) / 86400000;
    let score = 0;
    let reason = '';
    if (near(creditAmount, room, 0.005)) {
      score += 4;
      reason = toNumber(row.repaid) > 0 ? 'matches the amount still owed' : 'same amount';
    } else if (age <= SPLIT_WINDOW_DAYS) {
      // A share of a split bill, allowing a cent of rounding.
      const share = SPLIT_SHARES.find((n) => near(creditAmount, expense / n, 0.011));
      if (share) {
        score += 3;
        reason = `1/${share} of the bill`;
      }
    }
    if (Number(row.is_reimbursable)) {
      score += 3;
      reason = reason ? `${reason}, tagged reimbursable` : 'tagged reimbursable';
    }
    // The amount or a tag has to fit; category and recency only rank what does.
    if (score === 0) return null;
    if (row.category && row.category === credit.category) score += 1;
    return {
      id: Number(row.id),
      date: row.date,
      description: row.description,
      amount: toNumber(row.amount),
      category: row.category,
      repaid: round2(row.repaid),
      reason,
      score: score - age / days,
    };
  }).filter(Boolean);

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Transactions a reimbursement link could point at, for picking one by hand: expenses
// (side 'expense') or credits not yet linked (side 'credit'), from any date. The query
// matches the description, merchant or category, or an amount ("42.50", "$1,200");
// results come nearest to `nearDate` first.
export async function searchLinkCandidates(db, { side, query = '', nearDate, excludeId = null, limit = 20 } = {}) {
  const where = ['is_hidden = 0', side === 'credit' ? 'amount > 0 AND reimburses_id IS NULL' : 'amount < 0'];
  const params = [];
  if (excludeId !== null) {
    where.push('id <> ?');
    params.push(excludeId);
  }
  const text = normalizeText(query).toLowerCase();
  if (text) {
    const textMatch = "(LOWER(description) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(merchant, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(category, '')) LIKE ? ESCAPE '\\')";
    const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const amount = Number(text.replace(/[$,\s+-]/g, ''));
    if (/\d/.test(text) && Number.isFinite(amount) && amount > 0) {
      where.push(`(${textMatch} OR ABS(ABS(amount) - ?) < 0.005)`);
      params.push(like, like, like, amount);
    } else {
      where.push(textMatch);
      params.push(like, like, like);
    }
  }
  // Card payments and transfers can still be picked, but real spending comes first.
  const { reimbursementExcludedCategoriesSql } = await getAnalyticsSql(db);
  const rows = await queryRows(db, `
    SELECT id, date, description, amount, category,
           COALESCE((SELECT SUM(r.amount) FROM transactions r WHERE r.reimburses_id = t.id AND r.is_hidden = 0), 0) AS repaid
    FROM transactions t
    WHERE ${where.join(' AND ')}
    ORDER BY LOWER(COALESCE(category, '')) IN ${reimbursementExcludedCategoriesSql}, ABS(julianday(date) - julianday(?)), id DESC
    LIMIT ?;
  `, binds(...params, nearDate ?? new Date().toISOString().slice(0, 10), limit));
  return rows.map((row) => ({
    id: Number(row.id),
    date: row.date,
    description: row.description,
    amount: toNumber(row.amount),
    category: row.category,
    repaid: round2(row.repaid),
  }));
}

// ── Budgets ──────────────────────────────────────────────────────────────────

export async function getBudgets(db) {
  await bootstrapSchema(db);
  const rows = await queryRows(db, 'SELECT category, monthly_amount FROM budgets ORDER BY category;');
  return rows.map((row) => ({ category: row.category, monthly_amount: round2(row.monthly_amount) }));
}

export async function setBudget(db, category, monthlyAmount) {
  const clean = normalizeText(category);
  const amount = round2(Math.abs(toNumber(monthlyAmount, NaN)));
  if (!clean) throw new Error('Choose a category.');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a monthly amount above zero.');
  await db.exec(
    'INSERT INTO budgets (category, monthly_amount) VALUES (?, ?) ON CONFLICT(category) DO UPDATE SET monthly_amount = excluded.monthly_amount;',
    binds(clean, amount),
  );
  await saveDbToBrowser(db);
}

export async function deleteBudget(db, category) {
  await db.exec('DELETE FROM budgets WHERE category = ?;', binds(category));
  await saveDbToBrowser(db);
}

// Net spending per category for a date range (expenses minus reimbursements), the
// same figures the Analytics category breakdown shows.
export async function getNetSpendingByCategory(db, startDate, endDate) {
  const rows = await getCategoryNetSpending(db, { startDate, endDate });
  return new Map(rows.map((row) => [row.category, row.net]));
}

// Each budget with this month's spending and where it should be by today.
export async function getBudgetProgress(db, month, today = new Date().toISOString().slice(0, 10)) {
  const budgets = await getBudgets(db);
  if (budgets.length === 0) return [];
  const { start, end, days } = monthBounds(month);
  const spentByCategory = await getNetSpendingByCategory(db, start, end);
  const dayOfMonth = today.slice(0, 7) === month ? Number(today.slice(8, 10)) : (today > end ? days : 0);

  return budgets.map((budget) => {
    const spent = Math.max(spentByCategory.get(budget.category) ?? 0, 0);
    const expected = round2(budget.monthly_amount * (dayOfMonth / days));
    return {
      ...budget,
      spent,
      remaining: round2(budget.monthly_amount - spent),
      percent: budget.monthly_amount > 0 ? spent / budget.monthly_amount : 0,
      expectedByToday: expected,
      isOver: spent > budget.monthly_amount,
      isAheadOfPace: spent > expected && dayOfMonth < days,
    };
  });
}

// ── Recurring charges ────────────────────────────────────────────────────────

const CADENCES = [
  { name: 'weekly', days: 7, tolerance: 2 },
  { name: 'every two weeks', days: 14, tolerance: 3 },
  { name: 'monthly', days: 30.4, tolerance: 5 },
  { name: 'quarterly', days: 91, tolerance: 10 },
  { name: 'yearly', days: 365, tolerance: 20 },
];

const daysBetween = (a, b) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + Math.round(days) * 86400000).toISOString().slice(0, 10);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Finds charges that repeat on a steady cadence from the same merchant at a similar
 * amount (within 20%, so price changes stay in one series), e.g. subscriptions.
 * Flags price changes and series that seem to have stopped.
 */
export async function detectRecurringCharges(db, { today = new Date().toISOString().slice(0, 10) } = {}) {
  await bootstrapSchema(db);
  const rows = await queryRows(db, `
    SELECT id, date, amount, COALESCE(NULLIF(merchant, ''), description) AS merchant, category
    FROM transactions
    WHERE is_hidden = 0 AND amount < 0
    ORDER BY date ASC;
  `);

  const byMerchant = new Map();
  for (const row of rows) {
    const key = normalizeText(row.merchant).toLowerCase();
    if (!byMerchant.has(key)) byMerchant.set(key, []);
    byMerchant.get(key).push({ ...row, amount: Math.abs(toNumber(row.amount)) });
  }

  const results = [];
  for (const charges of byMerchant.values()) {
    if (charges.length < 3) continue;

    // Split one merchant's charges into amount clusters (e.g. two different plans).
    const clusters = [];
    for (const charge of charges) {
      const cluster = clusters.find((c) => Math.abs(charge.amount - c.reference) <= c.reference * 0.2);
      if (cluster) {
        cluster.items.push(charge);
        cluster.reference = charge.amount;
      } else {
        clusters.push({ reference: charge.amount, items: [charge] });
      }
    }

    for (const { items } of clusters) {
      // Same-day duplicates aren't separate occurrences.
      const series = items.filter((item, index) => index === 0 || item.date !== items[index - 1].date);
      if (series.length < 3) continue;

      const gaps = series.slice(1).map((item, index) => daysBetween(series[index].date, item.date));
      const typicalGap = median(gaps);
      const cadence = CADENCES.find((c) => Math.abs(typicalGap - c.days) <= c.tolerance);
      if (!cadence) continue;
      const steadyGaps = gaps.filter((gap) => Math.abs(gap - cadence.days) <= cadence.tolerance * 2).length;
      if (steadyGaps / gaps.length < 0.75) continue;

      const last = series[series.length - 1];
      const previous = series[series.length - 2];
      const nextExpected = addDays(last.date, cadence.days);
      results.push({
        merchant: last.merchant,
        category: last.category,
        cadence: cadence.name,
        occurrences: series.length,
        typicalAmount: round2(median(series.map((item) => item.amount))),
        lastAmount: round2(last.amount),
        previousAmount: round2(previous.amount),
        priceChange: round2(last.amount - previous.amount),
        firstDate: series[0].date,
        lastDate: last.date,
        nextExpected,
        // Missed by more than a full extra tolerance window: probably cancelled.
        isStopped: daysBetween(nextExpected, today) > cadence.tolerance * 2 + 3,
        yearlyCost: round2(median(series.map((item) => item.amount)) * (365 / cadence.days)),
      });
    }
  }

  return results.sort((a, b) => Number(a.isStopped) - Number(b.isStopped) || b.yearlyCost - a.yearlyCost);
}

// ── Net worth ────────────────────────────────────────────────────────────────

export async function getAccountBalances(db) {
  await bootstrapSchema(db);
  return queryRows(db, 'SELECT id, account, date, balance FROM account_balances ORDER BY date DESC, account;');
}

export async function setAccountBalance(db, { account, date, balance }) {
  const cleanAccount = normalizeText(account);
  const value = toNumber(balance, NaN);
  if (!cleanAccount) throw new Error('Enter the account name.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Enter the balance date.');
  if (!Number.isFinite(value)) throw new Error('Enter the balance.');
  await db.exec(
    'INSERT INTO account_balances (account, date, balance) VALUES (?, ?, ?) ON CONFLICT(account, date) DO UPDATE SET balance = excluded.balance;',
    binds(cleanAccount, date, round2(value)),
  );
  await saveDbToBrowser(db);
}

export async function deleteAccountBalance(db, id) {
  await db.exec('DELETE FROM account_balances WHERE id = ?;', binds(id));
  await saveDbToBrowser(db);
}

/**
 * Month-end net worth: for each account, its latest snapshot on or before the month end,
 * carried forward by that account's transactions since the snapshot. Accounts with no
 * snapshot yet don't count. Liabilities are entered as negative balances.
 */
export async function getNetWorthSeries(db, { months = 24, today = new Date().toISOString().slice(0, 10) } = {}) {
  const snapshots = await getAccountBalances(db);
  if (snapshots.length === 0) return [];

  const monthEnds = [];
  const [year, month] = today.split('-').map(Number);
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(year, month - 1 - i + 1, 0));
    const end = d.toISOString().slice(0, 10);
    monthEnds.push(end > today ? today : end);
  }
  const earliest = snapshots.reduce((min, s) => (s.date < min ? s.date : min), today);

  const accounts = [...new Set(snapshots.map((s) => s.account))];
  const series = [];
  for (const end of monthEnds) {
    if (end < earliest) continue;
    let total = 0;
    const byAccount = {};
    for (const account of accounts) {
      const snapshot = snapshots.find((s) => s.account === account && s.date <= end);
      if (!snapshot) continue;
      const delta = toNumber((await queryRows(db, `
        SELECT COALESCE(SUM(amount), 0) AS delta FROM transactions
        WHERE is_hidden = 0 AND account = ? AND date > ? AND date <= ?;
      `, binds(account, snapshot.date, end)))[0]?.delta);
      byAccount[account] = round2(toNumber(snapshot.balance) + delta);
      total += byAccount[account];
    }
    series.push({ date: end, netWorth: round2(total), byAccount });
  }
  return series;
}

// ── Year in review and exports ───────────────────────────────────────────────

export async function getYearSummary(db, year) {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const included = await getAnalyticsInclusionSql(db);
  const byCategory = await getNetSpendingByCategory(db, start, end);
  const [totals] = await queryRows(db, `
    SELECT
      COALESCE(SUM(CASE WHEN amount > 0 AND LOWER(category) = 'income' AND reimburses_id IS NULL AND ${included} THEN amount END), 0) AS income,
      COALESCE(SUM(CASE WHEN amount < 0 AND ${included} THEN -amount END), 0) AS gross_expenses
    FROM transactions WHERE is_hidden = 0 AND date BETWEEN ? AND ?;
  `, binds(start, end));
  const topMerchants = await queryRows(db, `
    SELECT COALESCE(NULLIF(merchant, ''), description) AS merchant, COUNT(*) AS count, SUM(-amount) AS spent
    FROM transactions
    WHERE is_hidden = 0 AND amount < 0 AND date BETWEEN ? AND ? AND ${included}
    GROUP BY 1 ORDER BY spent DESC LIMIT 10;
  `, binds(start, end));
  const monthly = await queryRows(db, `
    SELECT strftime('%m', date) AS month, COALESCE(SUM(CASE WHEN amount < 0 AND ${included} THEN -amount END), 0) AS spent
    FROM transactions WHERE is_hidden = 0 AND date BETWEEN ? AND ? GROUP BY 1 ORDER BY 1;
  `, binds(start, end));

  const income = round2(totals?.income);
  const netSpent = round2([...byCategory.values()].reduce((sum, value) => sum + value, 0));
  return {
    year,
    income,
    grossExpenses: round2(totals?.gross_expenses),
    netSpent,
    savingsRate: income > 0 ? (income - netSpent) / income : null,
    categories: [...byCategory.entries()]
      .map(([category, spent]) => ({ category, spent }))
      .filter((row) => row.spent > 0)
      .sort((a, b) => b.spent - a.spent),
    topMerchants: topMerchants.map((row) => ({ merchant: row.merchant, count: Number(row.count), spent: round2(row.spent) })),
    monthly: monthly.map((row) => ({ month: Number(row.month), spent: round2(row.spent) })),
  };
}

// Income, net spending and savings rate per month for the last `months` months
// (ending with the month containing `today`), using the same rules as getYearSummary:
// income is included "Income" rows; spending is net of reimbursements, as in the category breakdown.
export async function getMonthlySavingsRate(db, { months = 12, today = new Date().toISOString().slice(0, 10) } = {}) {
  await bootstrapSchema(db);
  const [year, month] = today.split('-').map(Number);
  const keys = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    keys.push(d.toISOString().slice(0, 7));
  }
  if (keys.length === 0) return [];
  const start = `${keys[0]}-01`;
  const end = monthBounds(keys[keys.length - 1]).end;
  const included = await getAnalyticsInclusionSql(db);

  const incomeRows = await queryRows(db, `
    SELECT strftime('%Y-%m', date) AS month, COALESCE(SUM(amount), 0) AS income
    FROM transactions
    WHERE is_hidden = 0 AND amount > 0 AND LOWER(category) = 'income' AND reimburses_id IS NULL AND ${included}
      AND date BETWEEN ? AND ?
    GROUP BY 1;
  `, binds(start, end));
  const spentByMonth = new Map();
  for (const row of await getCategoryNetSpending(db, { startDate: start, endDate: end, byMonth: true })) {
    spentByMonth.set(row.month, round2((spentByMonth.get(row.month) ?? 0) + row.net));
  }

  const incomeByMonth = new Map(incomeRows.map((row) => [row.month, round2(row.income)]));
  return keys.map((key) => {
    const income = incomeByMonth.get(key) ?? 0;
    const spent = spentByMonth.get(key) ?? 0;
    return {
      month: key,
      income,
      spent,
      saved: round2(income - spent),
      savingsRate: income > 0 ? (income - spent) / income : null,
    };
  });
}

// Distinct categories in use, plus any that have a budget, for pickers.
export async function getCategoryNames(db) {
  await bootstrapSchema(db);
  const rows = await queryRows(db, `
    SELECT category FROM transactions WHERE category IS NOT NULL AND TRIM(category) <> ''
    UNION
    SELECT category FROM budgets
    ORDER BY 1 COLLATE NOCASE;
  `);
  return rows.map((row) => String(row.category));
}

const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  // Quote, and neutralise spreadsheet formulas.
  const safe = /^[=+\-@]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function transactionsToCsv(rows) {
  const columns = ['date', 'description', 'merchant', 'amount', 'category', 'account', 'tags'];
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(Array.isArray(row[column]) ? row[column].join(' ') : row[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

// ── Possible duplicates ──────────────────────────────────────────────────────

// Pairs that look like the same purchase: same account and amount within 3 days,
// or identical rows kept as separate occurrences. For the review screen.
export async function getPossibleDuplicates(db) {
  await bootstrapSchema(db);
  const visible = (alias) => `${alias}.is_hidden = 0 AND ${alias}.split_parent_id IS NULL`;
  return queryRows(db, `
    SELECT a.id AS a_id, a.date AS a_date, a.description AS a_description, a.source_file AS a_source,
           b.id AS b_id, b.date AS b_date, b.description AS b_description, b.source_file AS b_source,
           a.amount, a.account
    FROM transactions a
    JOIN transactions b
      ON b.id > a.id
     AND b.account = a.account
     AND b.amount = a.amount
     AND ABS(julianday(b.date) - julianday(a.date)) <= 3
    WHERE ${visible('a')} AND ${visible('b')}
      AND (
        COALESCE(a.source_file, '') <> COALESCE(b.source_file, '')
        OR (a.date = b.date AND a.description = b.description)
      )
    ORDER BY a.date DESC
    LIMIT 200;
  `);
}

export { monthBounds };
