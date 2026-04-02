import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Pencil, Play, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { bootstrapSchema } from '../dbQueries.js';
import { useDatabase } from '../DatabaseContext.jsx';

const MATCH_COLUMNS = [
  { label: 'Description', value: 'description' },
  { label: 'Category', value: 'category' },
  { label: 'Account', value: 'account' },
  { label: 'Source File', value: 'source_file' },
  { label: 'Amount', value: 'amount' },
];

const MATCH_OPERATORS = [
  { label: 'Contains', value: 'contains' },
  { label: 'Equals', value: 'equals' },
  { label: 'Starts With', value: 'starts with' },
];

const ACTION_TYPES = [
  { label: 'Categorize', value: 'categorize' },
  { label: 'Split', value: 'split' },
];

const createSplitLine = () => ({
  category: '',
  amount: 0,
});

const createEmptyRule = () => ({
  id: null,
  name: '',
  priority: 0,
  match_column: 'description',
  match_operator: 'contains',
  match_value: '',
  action_type: 'categorize',
  action_payload: '',
  is_active: true,
});

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

const safeParseSplitPayload = (actionPayload) => {
  try {
    const parsed = typeof actionPayload === 'string' ? JSON.parse(actionPayload) : actionPayload;
    const splits = Array.isArray(parsed) ? parsed : parsed?.splits;

    if (!Array.isArray(splits) || splits.length === 0) {
      return [createSplitLine(), createSplitLine()];
    }

    return splits.map((line) => ({
      category: String(line?.category || ''),
      amount: Number(line?.amount || 0),
    }));
  } catch {
    return [createSplitLine(), createSplitLine()];
  }
};

const formatSplitSummary = (actionPayload) => {
  const splits = safeParseSplitPayload(actionPayload);
  const total = round2(splits.reduce((sum, line) => sum + (Number.isFinite(line.amount) ? line.amount : 0), 0));
  const labels = splits
    .map((line) => `${line.category || 'Unspecified'}: ${round2(line.amount).toFixed(2)}`)
    .join(' | ');

  return {
    count: splits.length,
    total,
    labels,
  };
};

export default function RulesDashboard() {
  const {
    db,
    dbName,
    isReady,
    triggerMutation,
    notifyDataChanged,
    getRules,
    createRule,
    updateRule,
    deleteRule,
    executeRuleOnDatabase,
  } = useDatabase();

  const [rules, setRules] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [form, setForm] = useState(createEmptyRule());
  const [splitLines, setSplitLines] = useState([createSplitLine(), createSplitLine()]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [runningRuleId, setRunningRuleId] = useState(null);

  const splitTotal = useMemo(
    () => round2(splitLines.reduce((sum, line) => sum + (Number.isFinite(line.amount) ? line.amount : 0), 0)),
    [splitLines],
  );

  const loadRules = async () => {
    if (!db) {
      setRules([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const rows = await getRules({});
      setRules(rows);
    } catch (error) {
      console.error(error);
      setAlert({ type: 'error', message: 'Failed to load rules from the database.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isReady || !db) return;

    const initialize = async () => {
      try {
        await bootstrapSchema(db);
        await loadRules();
      } catch (error) {
        console.error(error);
        setAlert({ type: 'error', message: 'Failed to initialize the rules schema.' });
        setIsLoading(false);
      }
    };

    initialize();
  }, [db, isReady, dbName]);

  const resetForm = () => {
    setEditingRuleId(null);
    setForm(createEmptyRule());
    setSplitLines([createSplitLine(), createSplitLine()]);
  };

  const editRule = (rule) => {
    setEditingRuleId(rule.id);
    setForm({
      id: rule.id,
      name: rule.name || '',
      priority: Number(rule.priority || 0),
      match_column: rule.match_column || 'description',
      match_operator: rule.match_operator || 'contains',
      match_value: rule.match_value || '',
      action_type: rule.action_type || 'categorize',
      action_payload: rule.action_type === 'categorize' ? String(rule.action_payload || '') : '',
      is_active: Boolean(rule.is_active),
    });
    setSplitLines(safeParseSplitPayload(rule.action_payload));
  };

  const handleFieldChange = (event) => {
    const { name, value, type, checked } = event.target;

    if (name === 'action_type') {
      setForm((prev) => ({
        ...prev,
        action_type: value,
        action_payload: value === 'categorize' ? prev.action_payload : prev.action_payload,
      }));

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

  const handleSplitLineChange = (index, field, value) => {
    setSplitLines((prev) => prev.map((line, currentIndex) => {
      if (currentIndex !== index) return line;
      return {
        ...line,
        [field]: field === 'amount' ? Number(value || 0) : value,
      };
    }));
  };

  const addSplitLine = () => {
    setSplitLines((prev) => [...prev, createSplitLine()]);
  };

  const removeSplitLine = (index) => {
    setSplitLines((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((_, currentIndex) => currentIndex !== index);
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.name.trim()) {
      setAlert({ type: 'error', message: 'Please provide a rule name.' });
      return;
    }

    if (!form.match_value.trim()) {
      setAlert({ type: 'error', message: 'Please provide a match value.' });
      return;
    }

    let actionPayload = form.action_payload.trim();
    if (form.action_type === 'categorize') {
      if (!actionPayload) {
        setAlert({ type: 'error', message: 'Categorize rules require a target category.' });
        return;
      }
    } else {
      const normalizedSplits = splitLines.map((line) => ({
        category: String(line.category || '').trim(),
        amount: Number(line.amount || 0),
      }));

      if (normalizedSplits.length < 2) {
        setAlert({ type: 'error', message: 'Split rules need at least two lines.' });
        return;
      }

      if (normalizedSplits.some((line) => !line.category || !Number.isFinite(line.amount) || Math.abs(line.amount) < 0.005)) {
        setAlert({ type: 'error', message: 'Each split line needs a category and a non-zero amount.' });
        return;
      }

      actionPayload = JSON.stringify({ splits: normalizedSplits });
    }

    const payload = {
      ...form,
      name: form.name.trim(),
      match_value: form.match_value.trim(),
      action_payload: actionPayload,
      priority: Number(form.priority || 0),
      is_active: Boolean(form.is_active),
    };

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

  const handleDelete = async (rule) => {
    if (!db) return;

    const confirmed = window.confirm(`Delete rule "${rule.name}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await deleteRule(rule.id);
      await loadRules();
      setAlert({ type: 'success', message: 'Rule deleted successfully.' });
      if (editingRuleId === rule.id) {
        resetForm();
      }
    } catch (error) {
      console.error(error);
      setAlert({ type: 'error', message: error?.message || 'Failed to delete rule.' });
    }
  };

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
          ? `Applied "${rule.name}" to ${affectedRows} historical row${affectedRows === 1 ? '' : 's'}.`
          : `Rule "${rule.name}" matched no historical rows.`,
      });
    } catch (error) {
      console.error(error);
      setAlert({ type: 'error', message: error?.message || 'Failed to run rule on existing data.' });
    } finally {
      setRunningRuleId(null);
    }
  };

  const renderRuleSummary = (rule) => {
    if (rule.action_type === 'split') {
      const { count, total, labels } = formatSplitSummary(rule.action_payload);
      return `${count} splits totaling ${total.toFixed(2)} | ${labels}`;
    }

    return `Set category to ${String(rule.action_payload || '').trim() || 'Uncategorized'}`;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
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

      {alert && (
        <div className={`p-4 rounded-xl flex items-start shadow-sm animate-in fade-in slide-in-from-top-2 ${alert.type === 'success'
          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
          : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
          {alert.type === 'success' ? (
            <CheckCircle2 className="h-5 w-5 mr-3 mt-0.5 flex-shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="h-5 w-5 mr-3 mt-0.5 flex-shrink-0 text-red-600" />
          )}
          <span className="font-medium text-sm sm:text-base leading-snug">{alert.message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-8 items-start">
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Create or edit rule</h2>
              <p className="text-sm text-gray-500 mt-1">Rules are ordered by priority from low to high.</p>
            </div>
            {editingRuleId !== null && (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <X className="h-4 w-4" />
                Cancel edit
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Match Column</label>
                <select
                  name="match_column"
                  value={form.match_column}
                  onChange={handleFieldChange}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all bg-white"
                >
                  {MATCH_COLUMNS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Operator</label>
                <select
                  name="match_operator"
                  value={form.match_operator}
                  onChange={handleFieldChange}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all bg-white"
                >
                  {MATCH_OPERATORS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Match Value</label>
              <input
                type="text"
                name="match_value"
                value={form.match_value}
                onChange={handleFieldChange}
                placeholder="Amazon"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Action Type</label>
              <select
                name="action_type"
                value={form.action_type}
                onChange={handleFieldChange}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all bg-white"
              >
                {ACTION_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {form.action_type === 'categorize' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Action Payload</label>
                <input
                  type="text"
                  name="action_payload"
                  value={form.action_payload}
                  onChange={handleFieldChange}
                  placeholder="Subscriptions"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">This is the category that will be written to matching transactions.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Split payload</h3>
                    <p className="text-xs text-gray-500 mt-1">Define the categories and amounts for the split rows.</p>
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
                  {splitLines.map((line, index) => (
                    <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end p-3 border border-gray-200 rounded-xl bg-gray-50/40">
                      <div className="md:col-span-7">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                        <input
                          type="text"
                          value={line.category}
                          onChange={(event) => handleSplitLineChange(index, 'category', event.target.value)}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
                          placeholder="Groceries"
                        />
                      </div>
                      <div className="md:col-span-4">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Amount</label>
                        <input
                          type="number"
                          step="0.01"
                          value={line.amount}
                          onChange={(event) => handleSplitLineChange(index, 'amount', event.target.value)}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
                          placeholder="-24.99"
                        />
                      </div>
                      <div className="md:col-span-1 flex md:justify-end">
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
                  ))}
                </div>

                <div className="p-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 flex items-center justify-between gap-4">
                  <span className="font-medium">Split total</span>
                  <span className="font-semibold text-gray-900">
                    {splitTotal.toFixed(2)}
                  </span>
                </div>
                <p className="text-xs text-gray-500">The split total must match the transaction amount when the rule runs.</p>
              </div>
            )}

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

        <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between gap-3">
            <div>
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

          <div className="p-6">
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
                  const isRunning = runningRuleId === rule.id;
                  return (
                    <article key={rule.id} className="p-4 rounded-2xl border border-gray-200 bg-white shadow-sm">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold text-gray-900">{rule.name}</h3>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${rule.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                              {rule.is_active ? 'Active' : 'Inactive'}
                            </span>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                              Priority {rule.priority}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 mt-2 break-words">
                            {rule.match_column} {rule.match_operator} “{rule.match_value}”
                          </p>
                          <p className="text-sm text-gray-500 mt-2 break-words">
                            {rule.action_type === 'split' ? 'Split' : 'Categorize'} | {renderRuleSummary(rule)}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleRunRule(rule)}
                            disabled={isRunning}
                            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-75"
                          >
                            {isRunning ? (
                              <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                            Run on Existing Data
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
