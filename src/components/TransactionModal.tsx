import { useState } from 'react';
import { X, Tag, Wand2 } from 'lucide-react';
import { useDatabase } from '../DatabaseContext.jsx';
import { normalizeTag, setTransactionTags, REIMBURSABLE_TAG } from '../db/features.js';
import ReimbursementSection from './transactions/ReimbursementSection';
import { errorMessage, type DatabaseContextValue, type Transaction } from './transactions/types';

interface TransactionFormData {
  date: string;
  description: string;
  amount: number;
  category: string;
  account: string;
  source_file?: string;
  manual_override?: number | null;
}

type InitialData = TransactionFormData & Partial<Transaction>;

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  initialData?: InitialData | null;
  /** May resolve with the saved row's id so tags can be stored for a new transaction. */
  onSubmit: (data: TransactionFormData & { tags: string[] }) => Promise<void | { id?: number } | undefined>;
  categories?: string[];
}

const emptyForm = (): TransactionFormData => ({
  date: new Date().toISOString().split('T')[0],
  description: '',
  amount: 0,
  category: '',
  account: 'Manual Entry',
});

const inputClass =
  'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all';

// The form mounts fresh every time the modal opens, so its state starts from the props
// instead of being copied in by an effect.
export default function TransactionModal(props: TransactionModalProps) {
  if (!props.isOpen) return null;
  const key = `${props.mode}:${props.initialData?.id ?? 'new'}`;
  return <TransactionForm key={key} {...props} />;
}

function TransactionForm({ onClose, mode, initialData, onSubmit, categories = [] }: TransactionModalProps) {
  const { db, notifyDataChanged, triggerMutation } = useDatabase() as DatabaseContextValue;
  const editing = mode === 'edit' && initialData ? initialData : null;

  const [formData, setFormData] = useState<TransactionFormData>(() => (editing
    ? {
      date: editing.date,
      description: editing.description,
      amount: editing.amount,
      category: editing.category,
      account: editing.account,
      source_file: editing.source_file,
      manual_override: editing.manual_override ?? null,
    }
    : emptyForm()));
  const initialTags = editing?.tags ?? [];
  const [tags, setTags] = useState<string[]>(initialTags);
  const [tagDraft, setTagDraft] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'amount') {
      setFormData(prev => ({ ...prev, [name]: parseFloat(value) || 0 }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const addTag = (raw: string) => {
    const clean = normalizeTag(raw);
    if (clean && !tags.includes(clean)) setTags((prev) => [...prev, clean].sort());
    setTagDraft('');
  };

  const removeTag = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag));

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagDraft);
    } else if (e.key === 'Backspace' && tagDraft === '' && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.description || !formData.date || !formData.category || !formData.account) {
      setError('Please fill in all required fields.');
      return;
    }

    // A tag typed but not yet confirmed still counts.
    const finalTags = tagDraft.trim() ? [...new Set([...tags, normalizeTag(tagDraft)])].filter(Boolean) : tags;

    try {
      setIsSubmitting(true);
      setError(null);
      const result = await onSubmit({ ...formData, tags: finalTags });
      const savedId = editing?.id ?? (result && typeof result === 'object' ? result.id : undefined);
      const tagsChanged = finalTags.length !== initialTags.length || finalTags.some((t) => !initialTags.includes(t));
      if (db && savedId && tagsChanged) {
        await setTransactionTags(db, savedId, finalTags);
        notifyDataChanged();
        triggerMutation();
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'An error occurred while saving.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const isExpense = formData.amount < 0;
  const isReimbursable = tags.includes(REIMBURSABLE_TAG);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-gray-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div role="dialog" aria-modal="true" aria-labelledby="transaction-modal-title" className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[95vh] sm:max-h-[90vh]">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <h2 id="transaction-modal-title" className="text-xl font-semibold text-gray-900">
            {mode === 'create' ? 'New Transaction' : 'Edit Transaction'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100" role="alert">
              {error}
            </div>
          )}

          {editing?.applied_rule_name && (
            <div className="flex items-center gap-2 p-2.5 text-sm rounded-lg border border-violet-200 bg-violet-50 text-violet-800">
              <Wand2 className="h-4 w-4 shrink-0" />
              <span>Category set by rule: <span className="font-semibold">{editing.applied_rule_name}</span></span>
            </div>
          )}

          <form id="transaction-form" onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="tx-date">Date *</label>
              <input id="tx-date" type="date" name="date" value={formData.date} onChange={handleChange} required className={inputClass} />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="tx-description">Description *</label>
              <input
                id="tx-description"
                type="text"
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="e.g. Grocery Store"
                required
                className={inputClass}
              />
              {editing?.merchant && editing.merchant !== formData.description && (
                <p className="text-xs text-gray-500 mt-1">Merchant: <span className="font-medium text-gray-700">{editing.merchant}</span></p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="tx-amount">Amount *</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 sm:text-sm">$</span>
                </div>
                <input
                  id="tx-amount"
                  type="number"
                  name="amount"
                  value={formData.amount}
                  onChange={handleChange}
                  step="0.01"
                  inputMode="decimal"
                  required
                  className={`${inputClass} pl-7`}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">Use negative values for expenses, positive for income.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="tx-category">Category *</label>
              <input
                id="tx-category"
                type="text"
                name="category"
                list="tx-category-options"
                value={formData.category}
                onChange={handleChange}
                placeholder="e.g. Groceries"
                required
                className={inputClass}
              />
              <datalist id="tx-category-options">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="tx-account">Account *</label>
              <input
                id="tx-account"
                type="text"
                name="account"
                value={formData.account}
                onChange={handleChange}
                placeholder="e.g. Checking"
                required
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="tx-tags">Tags</label>
              <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 border border-gray-200 rounded-lg focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-primary-500">
                {tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200">
                    <Tag className="h-3 w-3" />{tag}
                    <button type="button" onClick={() => removeTag(tag)} className="p-0.5 rounded-full hover:bg-violet-100" aria-label={`Remove tag ${tag}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <input
                  id="tx-tags"
                  type="text"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  onBlur={() => tagDraft.trim() && addTag(tagDraft)}
                  placeholder={tags.length ? '' : 'Type a tag and press Enter'}
                  className="flex-1 min-w-[120px] py-0.5 text-sm outline-none bg-transparent"
                />
              </div>
              {isExpense && (
                <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={isReimbursable}
                    onChange={(e) => (e.target.checked ? addTag(REIMBURSABLE_TAG) : removeTag(REIMBURSABLE_TAG))}
                  />
                  I expect to be paid back for this (tags it "{REIMBURSABLE_TAG}")
                </label>
              )}
            </div>
          </form>

          {editing?.id && !editing.is_split && <ReimbursementSection transaction={editing as Transaction} />}
        </div>

        <div className="px-4 sm:px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="transaction-form"
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 border border-transparent rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-70 flex items-center"
          >
            {isSubmitting ? (
              <><div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></div>Saving...</>
            ) : 'Save Transaction'}
          </button>
        </div>
      </div>
    </div>
  );
}
