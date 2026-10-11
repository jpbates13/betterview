import { useState } from 'react';
import { CheckCircle, Filter, Undo2, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { ImportSummary } from '../../types';

interface ImportResultsPanelProps {
  summary: ImportSummary;
  isFilteringToBatch: boolean;
  onToggleFilter: () => void;
  onUndo: () => Promise<void>;
  onDismiss: () => void;
}

const Stat = ({ label, value, tone = 'gray' }: { label: string; value: number; tone?: 'gray' | 'emerald' | 'sky' | 'amber' }) => {
  const tones = {
    gray: 'text-gray-900',
    emerald: 'text-emerald-700',
    sky: 'text-sky-700',
    amber: 'text-amber-700',
  };
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/70 px-3 py-2">
      <p className={`text-lg font-semibold ${tones[tone]}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
};

export default function ImportResultsPanel({ summary, isFilteringToBatch, onToggleFilter, onUndo, onDismiss }: ImportResultsPanelProps) {
  const [isUndoing, setIsUndoing] = useState(false);
  const [showSkipped, setShowSkipped] = useState(summary.skipped.length > 0 && summary.skipped.length <= 5);

  const handleUndo = async () => {
    setIsUndoing(true);
    try {
      await onUndo();
    } finally {
      setIsUndoing(false);
    }
  };

  return (
    <section
      aria-label="Import results"
      className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-emerald-200 animate-in fade-in slide-in-from-top-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <CheckCircle className="h-5 w-5 mt-0.5 shrink-0 text-emerald-600" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">Import finished</h2>
            <p className="text-sm text-gray-500 truncate" title={summary.fileName}>
              {summary.fileName}{summary.profileName ? ` · ${summary.profileName}` : ''}
            </p>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors shrink-0"
          aria-label="Dismiss import results"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Stat label="Added" value={summary.inserted} tone="emerald" />
        <Stat label="Duplicates skipped" value={summary.duplicates} />
        <Stat label="Categorized by rules" value={summary.categorizedByRules} tone="sky" />
        <Stat label="Split by rules" value={summary.splitByRules} tone="sky" />
        <Stat label="Unreadable lines" value={summary.skipped.length} tone={summary.skipped.length ? 'amber' : 'gray'} />
      </div>

      {summary.skipped.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60">
          <button
            onClick={() => setShowSkipped((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-amber-800"
            aria-expanded={showSkipped}
          >
            {summary.skipped.length} line{summary.skipped.length === 1 ? ' was' : 's were'} skipped
            {showSkipped ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showSkipped && (
            <ul className="max-h-48 overflow-y-auto border-t border-amber-200 divide-y divide-amber-100 text-sm">
              {summary.skipped.map((item) => (
                <li key={item.line} className="px-3 py-1.5 flex gap-3">
                  <span className="text-amber-700 font-mono text-xs shrink-0 pt-0.5">Line {item.line}</span>
                  <span className="text-gray-700 break-words min-w-0">{item.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {summary.inserted > 0 && (
          <button
            onClick={onToggleFilter}
            aria-pressed={isFilteringToBatch}
            className={`inline-flex items-center px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${isFilteringToBatch
              ? 'bg-primary-600 text-white border-primary-600 hover:bg-primary-700'
              : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
          >
            <Filter className="h-4 w-4 mr-2" />
            {isFilteringToBatch ? 'Showing only these rows' : 'Show only these rows'}
          </button>
        )}
        {summary.inserted > 0 && (
          <button
            onClick={handleUndo}
            disabled={isUndoing}
            className="inline-flex items-center px-3 py-2 rounded-lg border border-red-200 bg-white text-sm font-medium text-red-700 hover:bg-red-50 transition-colors disabled:opacity-60"
          >
            {isUndoing
              ? <span className="h-4 w-4 border-2 border-red-200 border-t-red-600 rounded-full animate-spin mr-2" />
              : <Undo2 className="h-4 w-4 mr-2" />}
            Undo this import
          </button>
        )}
      </div>
    </section>
  );
}
