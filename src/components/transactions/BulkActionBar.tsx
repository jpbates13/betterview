import { useMemo, useState } from 'react';
import { Eye, EyeOff, RotateCcw, Tag, Tags, Trash2, Wand2, X, FolderInput } from 'lucide-react';
import type { Transaction } from '../../types';

export interface BulkActionHandlers {
  onSetCategory: (rows: Transaction[], category: string) => Promise<void>;
  onSetOverride: (rows: Transaction[], status: number | null) => Promise<void>;
  onAddTag: (rows: Transaction[], tag: string) => Promise<void>;
  onRemoveTag: (rows: Transaction[], tag: string) => Promise<void>;
  onDelete: (rows: Transaction[]) => Promise<void>;
  onCreateRule: (rows: Transaction[], category: string) => void;
}

interface BulkActionBarProps extends BulkActionHandlers {
  selected: Transaction[];
  categories: string[];
  allTags: string[];
  onClear: () => void;
}

type Mode = 'category' | 'addTag' | 'removeTag' | null;

const buttonClass =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs sm:text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap';

export default function BulkActionBar({
  selected,
  categories,
  allTags,
  onClear,
  onSetCategory,
  onSetOverride,
  onAddTag,
  onRemoveTag,
  onDelete,
  onCreateRule,
}: BulkActionBarProps) {
  const [mode, setMode] = useState<Mode>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState('');

  const tagsInSelection = useMemo(
    () => Array.from(new Set(selected.flatMap((tx) => tx.tags || []))).sort(),
    [selected],
  );
  const splitHalfCount = useMemo(() => selected.filter((tx) => tx.is_split).length, [selected]);

  const openMode = (next: Mode) => {
    setMode((current) => (current === next ? null : next));
    setValue(next === 'category' ? categoryDraft : next === 'removeTag' ? (tagsInSelection[0] ?? '') : '');
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setMode(null);
      setValue('');
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (mode === 'category') {
      setCategoryDraft(trimmed);
      void run(() => onSetCategory(selected, trimmed));
    } else if (mode === 'addTag') {
      void run(() => onAddTag(selected, trimmed));
    } else if (mode === 'removeTag') {
      void run(() => onRemoveTag(selected, trimmed));
    }
  };

  const count = selected.length;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="sticky bottom-20 md:bottom-3 z-30 bg-white border border-primary-200 shadow-lg rounded-xl p-3 space-y-2 animate-in fade-in slide-in-from-bottom-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-900 mr-1">
          {count.toLocaleString()} selected
        </span>
        <button
          onClick={() => openMode('category')}
          disabled={busy}
          aria-pressed={mode === 'category'}
          className={`${buttonClass} ${mode === 'category' ? 'bg-primary-50 border-primary-300 text-primary-800' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}
        >
          <FolderInput className="h-3.5 w-3.5" /> Set category
        </button>
        <button
          onClick={() => run(() => onSetOverride(selected, 0))}
          disabled={busy}
          className={`${buttonClass} bg-white border-emerald-200 text-emerald-700 hover:bg-emerald-50`}
          title="Count these in analytics"
        >
          <Eye className="h-3.5 w-3.5" /> Include
        </button>
        <button
          onClick={() => run(() => onSetOverride(selected, 1))}
          disabled={busy}
          className={`${buttonClass} bg-white border-gray-200 text-gray-700 hover:bg-gray-50`}
          title="Leave these out of analytics"
        >
          <EyeOff className="h-3.5 w-3.5" /> Exclude
        </button>
        <button
          onClick={() => run(() => onSetOverride(selected, null))}
          disabled={busy}
          className={`${buttonClass} bg-white border-blue-200 text-blue-700 hover:bg-blue-50`}
          title="Let analytics settings decide"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Auto
        </button>
        <button
          onClick={() => openMode('addTag')}
          disabled={busy}
          aria-pressed={mode === 'addTag'}
          className={`${buttonClass} ${mode === 'addTag' ? 'bg-primary-50 border-primary-300 text-primary-800' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}
        >
          <Tag className="h-3.5 w-3.5" /> Add tag
        </button>
        <button
          onClick={() => openMode('removeTag')}
          disabled={busy || tagsInSelection.length === 0}
          aria-pressed={mode === 'removeTag'}
          className={`${buttonClass} ${mode === 'removeTag' ? 'bg-primary-50 border-primary-300 text-primary-800' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}
        >
          <Tags className="h-3.5 w-3.5" /> Remove tag
        </button>
        <button
          onClick={() => onCreateRule(selected, mode === 'category' ? value.trim() : categoryDraft)}
          disabled={busy}
          className={`${buttonClass} bg-white border-violet-200 text-violet-700 hover:bg-violet-50`}
        >
          <Wand2 className="h-3.5 w-3.5" /> Create rule
        </button>
        <button
          onClick={() => run(() => onDelete(selected))}
          disabled={busy}
          className={`${buttonClass} bg-white border-red-200 text-red-700 hover:bg-red-50`}
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
        <button
          onClick={onClear}
          className="ml-auto p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md"
          aria-label="Clear selection"
          title="Clear selection"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {mode && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          {mode === 'removeTag' ? (
            <select
              aria-label="Tag to remove"
              className="flex-1 min-w-[160px] px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500 outline-none"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            >
              {tagsInSelection.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
            </select>
          ) : (
            <>
              <input
                autoFocus
                aria-label={mode === 'category' ? 'New category' : 'Tag to add'}
                list={mode === 'category' ? 'bulk-category-options' : 'bulk-tag-options'}
                className="flex-1 min-w-[160px] px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500 outline-none"
                placeholder={mode === 'category' ? 'Category, e.g. Groceries' : 'Tag, e.g. vacation'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <datalist id="bulk-category-options">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
              <datalist id="bulk-tag-options">
                {allTags.map((t) => <option key={t} value={t} />)}
              </datalist>
            </>
          )}
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-60"
          >
            {busy ? 'Working…' : `Apply to ${count.toLocaleString()}`}
          </button>
          {mode === 'category' && splitHalfCount > 0 && (
            <p className="w-full text-xs text-amber-700">
              {splitHalfCount} split half{splitHalfCount === 1 ? '' : 's'} will be skipped. Undo the split to recategorize them.
            </p>
          )}
        </form>
      )}
    </div>
  );
}
