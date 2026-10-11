// Pure helpers shared by the rule editor, its live preview and the
// Transactions-page "make a rule" hand-off.

export const createCondition = (overrides = {}) => ({
  column: 'description',
  operator: 'contains',
  value: '',
  ...overrides,
});

export const createSplitLine = () => ({
  category: '',
  description: '',
  type: 'fixed',
  value: 0,
});

export const createEmptyRule = () => ({
  id: null,
  name: '',
  priority: 0,
  action_type: 'categorize',
  action_payload: '',
  is_active: true,
});

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

const PREFILL_COLUMNS = new Set(['merchant', 'description']);

/**
 * Turns `location.state.ruleDraft` ({ name, column, value, category }) into
 * initial editor state, or null when there is no usable draft.
 */
export const editorStateFromDraft = (draft) => {
  if (!draft || typeof draft !== 'object') return null;
  const value = String(draft.value ?? '').trim();
  if (!value) return null;
  const column = PREFILL_COLUMNS.has(draft.column) ? draft.column : 'description';
  const category = String(draft.category ?? '').trim();
  return {
    form: {
      ...createEmptyRule(),
      name: String(draft.name ?? '').trim() || `${value}${category ? ` → ${category}` : ''}`,
      action_payload: category,
    },
    matchType: 'all',
    conditions: [createCondition({ column, value })],
    splitLines: [createSplitLine(), createSplitLine()],
  };
};

const toMatchPayload = (matchType, conditions) => JSON.stringify({
  match_type: matchType,
  conditions: conditions.map((c) => ({
    column: c.column,
    operator: c.operator,
    value: String(c.value ?? '').trim(),
  })),
});

const normalizeSplits = (splitLines) => splitLines.map((line) => ({
  category: String(line.category || '').trim(),
  description: String(line.description || '').trim(),
  type: line.type,
  value: Number(line.value || 0),
}));

/**
 * Validates the editor state and builds the payload createRule/updateRule expect.
 * Returns { payload } or { error }.
 */
export const buildRulePayload = ({ form, matchType, conditions, splitLines }) => {
  if (!form.name.trim()) return { error: 'Please provide a rule name.' };
  if (conditions.some((c) => !String(c.value || '').trim())) {
    return { error: 'Every condition must have a value.' };
  }

  let actionPayload = String(form.action_payload || '').trim();
  if (form.action_type === 'categorize') {
    if (!actionPayload) return { error: 'Categorize rules require a target category.' };
  } else {
    if (splitLines.length < 2) return { error: 'Split rules need at least two lines.' };
    if (splitLines.some((l) => !String(l.category || '').trim())) return { error: 'Each split line needs a category.' };
    if (splitLines.filter((l) => l.type === 'remainder').length > 1) {
      return { error: 'A split rule may only have one Remainder line.' };
    }
    const totalPercentage = round2(splitLines
      .filter((l) => l.type === 'percentage')
      .reduce((sum, l) => sum + Number(l.value || 0), 0));
    if (totalPercentage > 100) {
      return { error: `Percentages must not exceed 100%. Current total: ${totalPercentage}%.` };
    }
    if (splitLines.some((l) => l.type === 'fixed' && Math.abs(Number(l.value || 0)) < 0.005)) {
      return { error: 'Fixed split amounts must be non-zero.' };
    }
    actionPayload = JSON.stringify({ splits: normalizeSplits(splitLines) });
  }

  return {
    payload: {
      ...form,
      name: form.name.trim(),
      match_payload: toMatchPayload(matchType, conditions),
      // V1 legacy fields mirror the first condition for backward compat.
      match_column: conditions[0]?.column || 'description',
      match_operator: conditions[0]?.operator || 'contains',
      match_value: String(conditions[0]?.value || '').trim(),
      action_payload: actionPayload,
      priority: Number(form.priority || 0),
      is_active: Boolean(form.is_active),
    },
  };
};

/**
 * The rule as it stands in the editor, for previewing. Lenient: blank
 * conditions are skipped, and null means there is nothing to match on yet.
 */
export const buildPreviewRule = ({ form, matchType, conditions, splitLines }) => {
  const filled = conditions.filter((c) => String(c.value ?? '').trim());
  if (filled.length === 0) return null;
  return {
    id: form.id ?? null,
    match_payload: toMatchPayload(matchType, filled),
    action_type: form.action_type,
    action_payload: form.action_type === 'split'
      ? JSON.stringify({ splits: normalizeSplits(splitLines) })
      : String(form.action_payload || '').trim(),
  };
};
