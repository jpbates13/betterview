import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Pencil, Play, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { bootstrapSchema, previewRule } from '../dbQueries.js';
import { useDatabase } from '../DatabaseContext.jsx';
import RulePreviewPanel from '../components/rules/RulePreviewPanel.jsx';
import RunRuleDialog from '../components/rules/RunRuleDialog.jsx';
import { useRulePreview } from '../components/rules/useRulePreview.js';
import {
  buildPreviewRule,
  buildRulePayload,
  createCondition,
  createEmptyRule,
  createSplitLine,
  editorStateFromDraft,
} from '../components/rules/ruleForm.js';

// ── Constants ────────────────────────────────────────────────────────────────

const MATCH_COLUMNS = [
  { label: 'Description', value: 'description' },
  { label: 'Merchant', value: 'merchant' },
  { label: 'Category', value: 'category' },
  { label: 'Account', value: 'account' },
  { label: 'Source File', value: 'source_file' },
  { label: 'Amount', value: 'amount' },
];

const MATCH_OPERATORS = [
  { label: 'Contains', value: 'contains' },
  { label: 'Equals', value: 'equals' },
  { label: 'Starts With', value: 'starts with' },
  { label: 'Greater Than', value: 'greater_than' },
  { label: 'Less Than', value: 'less_than' },
];

const ACTION_TYPES = [
  { label: 'Categorize', value: 'categorize' },
  { label: 'Split', value: 'split' },
];

const SPLIT_TYPES = [
  { label: 'Fixed ($)', value: 'fixed' },
  { label: 'Percentage (%)', value: 'percentage' },
  { label: 'Remainder', value: 'remainder' },
];

// ── Utilities ────────────────────────────────────────────────────────────────

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

const parseCsvInput = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index);

/** Parse a V2.5 match_payload string into { matchType, conditions }. */
const safeParseConditions = (matchPayload) => {
  if (!matchPayload) return { matchType: 'all', conditions: [createCondition()] };
  try {
    const parsed = typeof matchPayload === 'string' ? JSON.parse(matchPayload) : matchPayload;

    // V2.5 envelope: { match_type, conditions }
    if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.conditions) && parsed.conditions.length > 0) {
      return {
        matchType: parsed.match_type === 'any' ? 'any' : 'all',
        conditions: parsed.conditions.map((c) => ({
          column: String(c?.column || 'description'),
          operator: String(c?.operator || 'contains'),
          value: String(c?.value || ''),
        })),
      };
    }

    // V2 bare array — treat as 'all'
    if (Array.isArray(parsed) && parsed.length > 0) {
      return {
        matchType: 'all',
        conditions: parsed.map((c) => ({
          column: String(c?.column || 'description'),
          operator: String(c?.operator || 'contains'),
          value: String(c?.value || ''),
        })),
      };
    }
  } catch {
    // fall through
  }
  return { matchType: 'all', conditions: [createCondition()] };
};

/** Parse a V2 action_payload JSON string into split lines. */
const safeParseSplitPayload = (actionPayload) => {
  try {
    const parsed = typeof actionPayload === 'string' ? JSON.parse(actionPayload) : actionPayload;
    const splits = Array.isArray(parsed) ? parsed : parsed?.splits;

    if (!Array.isArray(splits) || splits.length === 0) {
      return [createSplitLine(), createSplitLine()];
    }

    return splits.map((line) => ({
      category: String(line?.category || ''),
      description: String(line?.description || ''),
      // Support both V1 (amount field) and V2 (type + value fields)
      type: String(line?.type || 'fixed'),
      value: Number(line?.value ?? line?.amount ?? 0),
    }));
  } catch {
    return [createSplitLine(), createSplitLine()];
  }
};

const formatConditionSummary = (matchPayload) => {
  const { matchType, conditions } = safeParseConditions(matchPayload);
  const separator = matchType === 'any' ? ' OR ' : ' AND ';
  const label = matchType === 'any' ? 'Matches ANY of' : 'Matches ALL of';
  const parts = conditions.map((c) => `${c.column} ${c.operator} "${c.value}"`);
  return `${label}: ${parts.join(separator)}`;
};

const formatSplitSummary = (actionPayload) => {
  const splits = safeParseSplitPayload(actionPayload);
  const labels = splits
    .map((line) => {
      if (line.type === 'remainder') return `${line.category || 'Unspecified'}: (remainder)`;
      if (line.type === 'percentage') return `${line.category || 'Unspecified'}: ${line.value}%`;
      return `${line.category || 'Unspecified'}: ${round2(line.value).toFixed(2)}`;
    })
    .join(' | ');

  return { count: splits.length, labels };
};

// ── Component ────────────────────────────────────────────────────────────────

export default function RulesDashboard() {
  const {
    db,
    dbName,
    isReady,
    dataVersion,
    triggerMutation,
    notifyDataChanged,
    getRules,
    createRule,
    updateRule,
    deleteRule,
    executeRuleOnDatabase,
    getAnalyticsSettingsConfig,
    updateAnalyticsSettingsConfig,
  } = useDatabase();
  const location = useLocation();
  const navigate = useNavigate();
  const editorRef = useRef(null);

  const [rules, setRules] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [editingRuleId, setEditingRuleId] = useState(null);

  // Form state
  const [form, setForm] = useState(createEmptyRule);
  const [matchType, setMatchType] = useState('all'); // 'all' (AND) | 'any' (OR)
  const [conditions, setConditions] = useState(() => [createCondition()]);
  const [splitLines, setSplitLines] = useState(() => [createSplitLine(), createSplitLine()]);
  const [isPrefilled, setIsPrefilled] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [runningRuleId, setRunningRuleId] = useState(null);
  const [runDialog, setRunDialog] = useState(null); // { rule, matchCount, changeCount, error }
  const runRequestRef = useRef(0);
  const [settingsForm, setSettingsForm] = useState({
    excludedCategoryKeywords: '',
    excludedDescriptionKeywords: '',
    reimbursementExcludedCategories: '',
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // ── Prefill from the Transactions page (location.state.ruleDraft) ─────────

  const ruleDraft = location.state?.ruleDraft;
  const [seenDraft, setSeenDraft] = useState(null);
  if (ruleDraft && ruleDraft !== seenDraft) {
    // Adjusting state during render: load the draft once per navigation.
    setSeenDraft(ruleDraft);
    const draftState = editorStateFromDraft(ruleDraft);
    if (draftState) {
      setEditingRuleId(null);
      setForm(draftState.form);
      setMatchType(draftState.matchType);
      setConditions(draftState.conditions);
      setSplitLines(draftState.splitLines);
      setIsPrefilled(true);
    }
  }

  useEffect(() => {
    if (!ruleDraft) return;
    // Drop the draft from history so a refresh doesn't reopen it.
    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null });
  }, [ruleDraft, navigate, location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (isPrefilled) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [isPrefilled]);

  // ── Split validation metrics ───────────────────────────────────────────────

  const remainderCount = useMemo(
    () => splitLines.filter((l) => l.type === 'remainder').length,
    [splitLines],
  );

  const totalPercentage = useMemo(
    () => round2(splitLines.filter((l) => l.type === 'percentage').reduce((sum, l) => sum + Number(l.value || 0), 0)),
    [splitLines],
  );

  const fixedTotal = useMemo(
    () => round2(splitLines.filter((l) => l.type === 'fixed').reduce((sum, l) => sum + Number(l.value || 0), 0)),
    [splitLines],
  );

  // ── Live preview of the rule being edited ─────────────────────────────────

  const previewDraft = useMemo(
    () => buildPreviewRule({ form, matchType, conditions, splitLines }),
    [form, matchType, conditions, splitLines],
  );
  const preview = useRulePreview(isReady ? db : null, previewDraft, { refreshToken: dataVersion });

  // ── Data loaders ──────────────────────────────────────────────────────────

  const loadRules = useCallback(async () => {
    if (!db) { setRules([]); setIsLoading(false); return; }
    try {
      setIsLoading(true);
      setRules(await getRules({}));
    } catch (error) {
      console.error(error);
      setAlert({ type: 'error', message: 'Failed to load rules from the database.' });
    } finally {
      setIsLoading(false);
    }
  }, [db, getRules]);

  const loadAnalyticsSettings = useCallback(async () => {
    if (!db) return;
    try {
      const config = await getAnalyticsSettingsConfig();
      if (!config) return;
      setSettingsForm({
        excludedCategoryKeywords: (config.excluded_category_keywords || []).join(', '),
        excludedDescriptionKeywords: (config.excluded_description_keywords || []).join(', '),
        reimbursementExcludedCategories: (config.reimbursement_excluded_categories || []).join(', '),
      });
    } catch (error) {
      console.error(error);
      setAlert({ type: 'error', message: 'Failed to load analytics defaults.' });
    }
  }, [db, getAnalyticsSettingsConfig]);

  useEffect(() => {
    if (!isReady || !db) return;
    const initialize = async () => {
      try {
        await bootstrapSchema(db);
        await loadRules();
        await loadAnalyticsSettings();
      } catch (error) {
        console.error(error);
        setAlert({ type: 'error', message: 'Failed to initialize the rules schema.' });
        setIsLoading(false);
      }
    };
    initialize();
  }, [db, isReady, dbName, loadRules, loadAnalyticsSettings]);

  // ── Settings handlers ─────────────────────────────────────────────────────

  const handleSettingsInputChange = (event) => {
    const { name, value } = event.target;
    setSettingsForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSaveAnalyticsSettings = async (event) => {
    event.preventDefault();
    try {
      setIsSavingSettings(true);
      setAlert(null);
      await updateAnalyticsSettingsConfig({
        excluded_category_keywords: parseCsvInput(settingsForm.excludedCategoryKeywords),
        excluded_description_keywords: parseCsvInput(settingsForm.excludedDescriptionKeywords),
        reimbursement_excluded_categories: parseCsvInput(settingsForm.reimbursementExcludedCategories),
      });
      await loadAnalyticsSettings();
      setAlert({ type: 'success', message: 'Analytics defaults updated successfully.' });
    } catch (error) {
      console.error(error);
      setAlert({ type: 'error', message: error?.message || 'Failed to save analytics defaults.' });
    } finally {
      setIsSavingSettings(false);
    }
  };

  // ── Rule form helpers ─────────────────────────────────────────────────────

  const resetForm = () => {
    setEditingRuleId(null);
    setForm(createEmptyRule());
    setMatchType('all');
    setConditions([createCondition()]);
    setSplitLines([createSplitLine(), createSplitLine()]);
    setIsPrefilled(false);
  };

  const editRule = (rule) => {
    setIsPrefilled(false);
    setEditingRuleId(rule.id);
    setForm({
      id: rule.id,
      name: rule.name || '',
      priority: Number(rule.priority || 0),
      action_type: rule.action_type || 'categorize',
      action_payload: rule.action_type === 'categorize' ? String(rule.action_payload || '') : '',
      is_active: Boolean(rule.is_active),
    });
    // Populate conditions + match_type from match_payload (V2.5/V2) or legacy V1 fields
    if (rule.match_payload) {
      const { matchType: mt, conditions: conds } = safeParseConditions(rule.match_payload);
      setMatchType(mt);
      setConditions(conds);
    } else {
      setMatchType('all');
      setConditions([{
        column: rule.match_column || 'description',
        operator: rule.match_operator || 'contains',
        value: rule.match_value || '',
      }]);
    }
    setSplitLines(safeParseSplitPayload(rule.action_payload));
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleFieldChange = (event) => {
    const { name, value, type, checked } = event.target;

    if (name === 'action_type') {
      setForm((prev) => ({ ...prev, action_type: value }));
      if (value === 'split' && splitLines.length < 2) {
        setSplitLines([createSplitLine(), createSplitLine()]);
      }
      return;
    }

    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  // ── Condition list handlers ────────────────────────────────────────────────

  const handleConditionChange = (index, field, value) => {
    setConditions((prev) => prev.map((c, i) => i !== index ? c : { ...c, [field]: value }));
  };

  const addCondition = () => setConditions((prev) => [...prev, createCondition()]);

  const removeCondition = (index) => {
    setConditions((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  };

  // ── Split line handlers ───────────────────────────────────────────────────

  const handleSplitLineChange = (index, field, value) => {
    setSplitLines((prev) => prev.map((line, i) => {
      if (i !== index) return line;
      return {
        ...line,
        [field]: field === 'value' ? Number(value || 0) : value,
        // When switching to Remainder, clear value
        ...(field === 'type' && value === 'remainder' ? { value: 0 } : {}),
      };
    }));
  };

  const addSplitLine = () => setSplitLines((prev) => [...prev, createSplitLine()]);

  const removeSplitLine = (index) => {
    setSplitLines((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((_, i) => i !== index);
    });
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async (event) => {
    event.preventDefault();

    const { payload, error: validationError } = buildRulePayload({ form, matchType, conditions, splitLines });
    if (validationError) {
      setAlert({ type: 'error', message: validationError });
      return;
    }

    try {
      setIsSubmitting(true);
      setAlert(null);

      if (editingRuleId === null) {
        await createRule(payload);
        setAlert({ type: 'success', message: 'Rule created successfully.' });
      } else {
        await updateRule(editingRuleId, payload);
        setAlert({ type: 'success', message: 'Rule updated successfully.' });
      }

      await loadRules();
      resetForm();
    } catch (error) {
      console.error(error);
      setAlert({ type: 'error', message: error?.message || 'Failed to save rule.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Rule management handlers ──────────────────────────────────────────────

  const handleDelete = async (rule) => {
    if (!db) return;
    const confirmed = window.confirm(`Delete rule "${rule.name}"? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await deleteRule(rule.id);
      await loadRules();
      setAlert({ type: 'success', message: 'Rule deleted successfully.' });
      if (editingRuleId === rule.id) resetForm();
    } catch (error) {
      console.error(error);
      setAlert({ type: 'error', message: error?.message || 'Failed to delete rule.' });
    }
  };

  const openRunDialog = async (rule) => {
    if (!db) return;
    const requestId = runRequestRef.current + 1;
    runRequestRef.current = requestId;
    setRunDialog({ rule, matchCount: null, changeCount: null, error: null });
    try {
      const rows = await previewRule(db, rule);
      if (runRequestRef.current !== requestId) return;
      const changeCount = rows.filter((row) => row.change !== 'already in category').length;
      setRunDialog({ rule, matchCount: rows.length, changeCount, error: null });
    } catch (error) {
      if (runRequestRef.current !== requestId) return;
      setRunDialog({ rule, matchCount: null, changeCount: null, error: error?.message || 'Could not preview this rule.' });
    }
  };

  const closeRunDialog = useCallback(() => {
    runRequestRef.current += 1;
    setRunDialog(null);
  }, []);

  const handleRunRule = async (rule) => {
    if (!db) return;
    try {
      setRunningRuleId(rule.id);
      setAlert(null);
      const affectedRows = await executeRuleOnDatabase(rule);
      notifyDataChanged();
      triggerMutation();
      setAlert({
        type: 'success',
        message: affectedRows > 0
          ? `Applied "${rule.name}" to ${affectedRows} existing row${affectedRows === 1 ? '' : 's'}.`
          : `Rule "${rule.name}" matched no existing transactions.`,
      });
    } catch (error) {
      console.error(error);
      setAlert({ type: 'error', message: error?.message || 'Failed to run rule on existing data.' });
    } finally {
      setRunningRuleId(null);
      closeRunDialog();
    }
  };

  // ── Summary renderer ──────────────────────────────────────────────────────

  const renderRuleSummary = (rule) => {
    const matchSummary = rule.match_payload
      ? formatConditionSummary(rule.match_payload)
      : `Matches ALL of: ${rule.match_column} ${rule.match_operator} "${rule.match_value}"`;

    const actionSummary = rule.action_type === 'split'
      ? (() => { const { count, labels } = formatSplitSummary(rule.action_payload); return `${count} splits | ${labels}`; })()
      : `Set category to ${String(rule.action_payload || '').trim() || 'Uncategorized'}`;

    return { matchSummary, actionSummary };
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Rules Engine</h1>
          <p className="text-gray-500 mt-1">Auto-categorize and auto-split transactions before import, or sweep existing data on demand.</p>
          <p className="text-xs text-gray-500 mt-2">
            Active DB: <span className="font-medium text-gray-700">{dbName || 'In-memory database'}</span>
          </p>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-600">
          <SparklesBadge />
          <span className="font-medium">{rules.length} rule{rules.length === 1 ? '' : 's'} configured</span>
        </div>
      </div>

      {/* Alert */}
      {alert && (
        <div className={`p-4 rounded-xl flex items-start shadow-sm animate-in fade-in slide-in-from-top-2 ${alert.type === 'success'
          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
          : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
          {alert.type === 'success'
            ? <CheckCircle2 className="h-5 w-5 mr-3 mt-0.5 flex-shrink-0 text-emerald-600" />
            : <AlertCircle className="h-5 w-5 mr-3 mt-0.5 flex-shrink-0 text-red-600" />}
          <span className="font-medium text-sm sm:text-base leading-snug">{alert.message}</span>
        </div>
      )}

      {/* Analytics Settings */}
      <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50/60">
          <h2 className="text-lg font-semibold text-gray-900">Analytics defaults</h2>
          <p className="text-sm text-gray-500 mt-1">Comma-separated keywords and categories used for exclusion and reimbursement math.</p>
        </div>
        <form onSubmit={handleSaveAnalyticsSettings} className="p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Excluded category keywords</label>
            <input
              type="text"
              name="excludedCategoryKeywords"
              value={settingsForm.excludedCategoryKeywords}
              onChange={handleSettingsInputChange}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
              placeholder="transfer, saving"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Excluded description keywords</label>
            <input
              type="text"
              name="excludedDescriptionKeywords"
              value={settingsForm.excludedDescriptionKeywords}
              onChange={handleSettingsInputChange}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
              placeholder="bill payment, payment thank you"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reimbursement-excluded categories</label>
            <input
              type="text"
              name="reimbursementExcludedCategories"
              value={settingsForm.reimbursementExcludedCategories}
              onChange={handleSettingsInputChange}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
              placeholder="income, transfers, credit card payment"
            />
          </div>
          <div className="lg:col-span-3 flex justify-end">
            <button
              type="submit"
              disabled={isSavingSettings}
              className="inline-flex items-center justify-center px-5 py-2.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 hover:shadow-md transition-all disabled:opacity-75"
            >
              {isSavingSettings ? 'Saving...' : 'Save Analytics Defaults'}
            </button>
          </div>
        </form>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-6 sm:gap-8 items-start">
        {/* ── Create / Edit Rule Form ────────────────────────────────────────── */}
        <section ref={editorRef} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden scroll-mt-4">
          <div className="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50/60 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingRuleId !== null ? 'Edit rule' : 'Create or edit rule'}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {isPrefilled
                  ? 'Prefilled from a transaction. Check the matches below, then save.'
                  : 'Rules are ordered by priority from low to high.'}
              </p>
            </div>
            {(editingRuleId !== null || isPrefilled) && (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <X className="h-4 w-4" />
                {editingRuleId !== null ? 'Cancel edit' : 'Discard'}
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-5">
            {/* Name + Priority */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={handleFieldChange}
                  placeholder="Weekend subscriptions"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                <input
                  type="number"
                  name="priority"
                  value={form.priority}
                  onChange={handleFieldChange}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
                />
              </div>
            </div>

            {/* ── Compound Conditions ─────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Match conditions</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Define when this rule should trigger.</p>
                </div>
                <button
                  type="button"
                  onClick={addCondition}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  Add Condition
                </button>
              </div>

              {/* Match Requirement toggle */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 rounded-xl border border-indigo-100 bg-indigo-50/40">
                <label htmlFor="rule-match-type" className="text-xs font-semibold text-indigo-700 whitespace-nowrap">Match Requirement</label>
                <select
                  id="rule-match-type"
                  value={matchType}
                  onChange={(e) => setMatchType(e.target.value)}
                  className="w-full sm:flex-1 min-w-0 px-3 py-1.5 border border-indigo-200 rounded-lg text-sm text-indigo-900 bg-white focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition-all"
                >
                  <option value="all">Match ALL of the following conditions (AND)</option>
                  <option value="any">Match ANY of the following conditions (OR)</option>
                </select>
              </div>

              <div className="space-y-2">
                {conditions.map((condition, index) => (
                  <div key={index}>
                    {index > 0 && (
                      <div className="flex items-center gap-2 my-1">
                        <div className="flex-1 h-px bg-gray-200" />
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                          matchType === 'any'
                            ? 'text-amber-700 bg-amber-50 border-amber-200'
                            : 'text-indigo-600 bg-indigo-50 border-indigo-200'
                        }`}>
                          {matchType === 'any' ? 'OR' : 'AND'}
                        </span>
                        <div className="flex-1 h-px bg-gray-200" />
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end p-3 border border-gray-200 rounded-xl bg-gray-50/40">
                      {/* Column */}
                      <div className="md:col-span-4">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Column</label>
                        <select
                          value={condition.column}
                          onChange={(e) => handleConditionChange(index, 'column', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all bg-white"
                        >
                          {MATCH_COLUMNS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      {/* Operator */}
                      <div className="md:col-span-3">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Operator</label>
                        <select
                          value={condition.operator}
                          onChange={(e) => handleConditionChange(index, 'operator', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all bg-white"
                        >
                          {MATCH_OPERATORS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      {/* Value */}
                      <div className="md:col-span-4">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Value</label>
                        <input
                          type="text"
                          value={condition.value}
                          onChange={(e) => handleConditionChange(index, 'value', e.target.value)}
                          placeholder={condition.column === 'merchant' ? 'Blue Bottle Coffee' : condition.column === 'amount' ? '-100' : 'Amazon'}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
                        />
                      </div>
                      {/* Remove */}
                      <div className="md:col-span-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => removeCondition(index)}
                          disabled={conditions.length <= 1}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-40"
                          title="Remove condition"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Action Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Action Type</label>
              <select
                name="action_type"
                value={form.action_type}
                onChange={handleFieldChange}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all bg-white"
              >
                {ACTION_TYPES.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Action Payload */}
            {form.action_type === 'categorize' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target Category</label>
                <input
                  type="text"
                  name="action_payload"
                  value={form.action_payload}
                  onChange={handleFieldChange}
                  placeholder="Subscriptions"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">This category will be written to matching transactions.</p>
              </div>
            ) : (
              /* ── Dynamic Split Payload ───────────────────────────────── */
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Split payload</h3>
                    <p className="text-xs text-gray-500 mt-1">Define splits using fixed amounts, percentages, or a remainder.</p>
                  </div>
                  <button
                    type="button"
                    onClick={addSplitLine}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    Add line
                  </button>
                </div>

                <div className="space-y-3">
                  {splitLines.map((line, index) => {
                    const isRemainder = line.type === 'remainder';
                    return (
                      <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end p-3 border border-gray-200 rounded-xl bg-gray-50/40">
                        {/* Category */}
                        <div className="md:col-span-4">
                          <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                          <input
                            type="text"
                            value={line.category}
                            onChange={(e) => handleSplitLineChange(index, 'category', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
                            placeholder="Groceries"
                          />
                        </div>
                        {/* Type */}
                        <div className="md:col-span-3">
                          <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                          <select
                            value={line.type}
                            onChange={(e) => handleSplitLineChange(index, 'type', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all bg-white"
                          >
                            {SPLIT_TYPES.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        {/* Value */}
                        <div className="md:col-span-4">
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            {isRemainder ? 'Value (auto)' : line.type === 'percentage' ? 'Percentage (%)' : 'Amount ($)'}
                          </label>
                          <input
                            type="number"
                            step={line.type === 'percentage' ? '0.1' : '0.01'}
                            value={line.value}
                            disabled={isRemainder}
                            onChange={(e) => handleSplitLineChange(index, 'value', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all disabled:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400"
                            placeholder={isRemainder ? 'Calculated automatically' : line.type === 'percentage' ? '50' : '-24.99'}
                          />
                        </div>
                        {/* Remove */}
                        <div className="md:col-span-1 flex justify-end">
                          <button
                            type="button"
                            onClick={() => removeSplitLine(index)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-40"
                            disabled={splitLines.length <= 2}
                            title="Remove split line"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Validation Hints */}
                <div className="space-y-1.5">
                  {remainderCount > 1 && (
                    <p className="text-xs text-red-600 font-medium">⚠ Only one Remainder line is allowed.</p>
                  )}
                  {totalPercentage > 100 && (
                    <p className="text-xs text-red-600 font-medium">⚠ Percentage total ({totalPercentage}%) exceeds 100%.</p>
                  )}
                  {remainderCount === 0 && (
                    <p className="text-xs text-gray-500">
                      Fixed total: <span className="font-medium">{fixedTotal.toFixed(2)}</span> + {totalPercentage}% of transaction.
                      The split total must match the parent transaction at rule-run time.
                    </p>
                  )}
                  {remainderCount === 1 && (
                    <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-1.5">
                      ✓ Remainder will absorb everything not claimed by fixed + percentage lines.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Live preview against existing transactions */}
            <RulePreviewPanel preview={preview} />

            {/* Active toggle */}
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 select-none">
              <input
                type="checkbox"
                name="is_active"
                checked={form.is_active}
                onChange={handleFieldChange}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              Active
            </label>

            {/* Submit row */}
            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Reset
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center justify-center px-5 py-2.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 hover:shadow-md transition-all disabled:opacity-75"
              >
                {isSubmitting ? 'Saving...' : editingRuleId === null ? 'Create Rule' : 'Update Rule'}
              </button>
            </div>
          </form>
        </section>

        {/* ── Existing Rules ─────────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50/60 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900">Existing rules</h2>
              <p className="text-sm text-gray-500 mt-1">Edit, delete, or run any rule against historical transactions.</p>
            </div>
            <button
              type="button"
              onClick={loadRules}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Refresh
            </button>
          </div>

          <div className="p-4 sm:p-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-gray-500">
                <div className="h-6 w-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin mr-3" />
                Loading rules...
              </div>
            ) : rules.length === 0 ? (
              <div className="text-center py-16 rounded-2xl border border-dashed border-gray-200 bg-gray-50/40">
                <p className="text-gray-700 font-medium">No rules yet</p>
                <p className="text-sm text-gray-500 mt-1">Create your first rule to start automating categorization and splits.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {rules.map((rule) => {
                  const { matchSummary, actionSummary } = renderRuleSummary(rule);
                  const isRunning = runningRuleId === rule.id;
                  return (
                    <article key={rule.id} className="p-4 rounded-2xl border border-gray-200 bg-white shadow-sm">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold text-gray-900 break-words min-w-0">{rule.name}</h3>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${rule.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                              {rule.is_active ? 'Active' : 'Inactive'}
                            </span>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                              Priority {rule.priority}
                            </span>
                          </div>
                          {/* Match summary */}
                          <p className="text-sm text-gray-600 mt-2 break-words">{matchSummary}</p>
                          {/* Action summary */}
                          <p className="text-sm text-gray-500 mt-1 break-words">
                            {rule.action_type === 'split' ? 'Split' : 'Categorize'} | {actionSummary}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => openRunDialog(rule)}
                            disabled={isRunning || runDialog !== null}
                            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-75"
                          >
                            {isRunning
                              ? <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              : <Play className="h-4 w-4" />}
                            Run on existing transactions
                          </button>
                          <button
                            type="button"
                            onClick={() => editRule(rule)}
                            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                          >
                            <Pencil className="h-4 w-4" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(rule)}
                            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-100 rounded-lg hover:bg-red-100 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {runDialog && (
        <RunRuleDialog
          rule={runDialog.rule}
          matchCount={runDialog.matchCount}
          changeCount={runDialog.changeCount}
          error={runDialog.error}
          isRunning={runningRuleId === runDialog.rule.id}
          onConfirm={() => handleRunRule(runDialog.rule)}
          onCancel={closeRunDialog}
        />
      )}
    </div>
  );
}

function SparklesBadge() {
  return (
    <div className="h-8 w-8 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center">
      <Sparkles className="h-4 w-4" />
    </div>
  );
}
