import { useState } from 'react';
import { X, Table2 } from 'lucide-react';
import { DATE_FORMATS, guessProfile, validateProfile } from '../../csvImporter.js';
import type { CsvProfile } from './types';

interface CsvMappingModalProps {
  fileName: string;
  headers: string[];
  sampleRows: Array<Record<string, unknown>>;
  onCancel: () => void;
  // Resolves when the import has finished; rejects with a message to show in the modal.
  onConfirm: (profile: CsvProfile, saveProfile: boolean) => Promise<void>;
}

type ColumnKey = 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'account' | 'category';

const inputClass =
  'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none';

export default function CsvMappingModal({ fileName, headers, sampleRows, onCancel, onConfirm }: CsvMappingModalProps) {
  const [profile, setProfile] = useState<CsvProfile>(() => {
    const guess = guessProfile(headers) as CsvProfile;
    // Prefer a single amount column when one was found; otherwise fall back to debit/credit.
    return guess.amount ? { ...guess, debit: null, credit: null } : guess;
  });
  const [amountMode, setAmountMode] = useState<'single' | 'split'>(() => {
    const guess = guessProfile(headers) as CsvProfile;
    return !guess.amount && (guess.debit || guess.credit) ? 'split' : 'single';
  });
  const [saveFormat, setSaveFormat] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setColumn = (key: ColumnKey, value: string) => {
    setProfile((prev) => ({ ...prev, [key]: value || null }));
  };

  const switchAmountMode = (mode: 'single' | 'split') => {
    setAmountMode(mode);
    setProfile((prev) => (mode === 'single' ? { ...prev, debit: null, credit: null } : { ...prev, amount: null }));
  };

  const handleConfirm = async () => {
    const candidate: CsvProfile = { ...profile, headers };
    const problem = validateProfile(candidate);
    if (problem) {
      setError(problem);
      return;
    }
    if (saveFormat && !candidate.name.trim()) {
      setError('Give this format a name so it can be reused, or untick "Save this format".');
      return;
    }
    try {
      setIsSubmitting(true);
      setError(null);
      await onConfirm({ ...candidate, name: candidate.name.trim() || `Custom (${fileName})` }, saveFormat);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Import failed.');
      setIsSubmitting(false);
    }
  };

  const renderColumnSelect = (key: ColumnKey, label: string, required = false, noneLabel = 'Not in this file') => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={`csv-map-${key}`}>
        {label}{required ? ' *' : ''}
      </label>
      <select
        id={`csv-map-${key}`}
        className={inputClass}
        value={profile[key] ?? ''}
        onChange={(e) => setColumn(key, e.target.value)}
      >
        <option value="">{required ? 'Choose a column…' : noneLabel}</option>
        {headers.map((header) => (
          <option key={header} value={header}>{header}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-gray-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="csv-mapping-title"
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[95vh]"
      >
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3 bg-gray-50/50">
          <div className="min-w-0">
            <h2 id="csv-mapping-title" className="text-lg sm:text-xl font-semibold text-gray-900">Map CSV columns</h2>
            <p className="text-xs sm:text-sm text-gray-500 truncate" title={fileName}>
              BetterView doesn't recognise <span className="font-medium text-gray-700">{fileName}</span> yet. Tell it which column is which.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors shrink-0"
            aria-label="Cancel import"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-5">
          {error && (
            <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100" role="alert">{error}</div>
          )}

          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-1.5">
              <Table2 className="h-4 w-4 text-gray-500" /> First rows of the file
            </h3>
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    {headers.map((header) => (
                      <th key={header} className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sampleRows.map((row, index) => (
                    <tr key={index}>
                      {headers.map((header) => (
                        <td key={header} className="px-3 py-1.5 text-gray-700 whitespace-nowrap max-w-[220px] truncate">
                          {String(row[header] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {sampleRows.length === 0 && (
                    <tr><td colSpan={headers.length} className="px-3 py-3 text-gray-500">The file has no data rows.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            {renderColumnSelect('date', 'Date column', true)}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="csv-map-date-format">Date format</label>
              <select
                id="csv-map-date-format"
                className={inputClass}
                value={profile.dateFormat}
                onChange={(e) => setProfile((prev) => ({ ...prev, dateFormat: e.target.value }))}
              >
                {DATE_FORMATS.map((format) => (
                  <option key={format.value} value={format.value}>{format.label}</option>
                ))}
              </select>
            </div>
            {renderColumnSelect('description', 'Description column', true)}
            {renderColumnSelect('category', 'Category column', false, 'None (use "Uncategorized")')}
          </section>

          <section className="space-y-3">
            <fieldset>
              <legend className="text-sm font-medium text-gray-700 mb-2">Amounts are in</legend>
              <div className="flex flex-wrap gap-2">
                <label className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer ${amountMode === 'single' ? 'border-primary-500 bg-primary-50 text-primary-800' : 'border-gray-200 text-gray-700'}`}>
                  <input type="radio" name="amount-mode" checked={amountMode === 'single'} onChange={() => switchAmountMode('single')} />
                  One amount column
                </label>
                <label className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer ${amountMode === 'split' ? 'border-primary-500 bg-primary-50 text-primary-800' : 'border-gray-200 text-gray-700'}`}>
                  <input type="radio" name="amount-mode" checked={amountMode === 'split'} onChange={() => switchAmountMode('split')} />
                  Separate debit and credit columns
                </label>
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              {amountMode === 'single' ? (
                renderColumnSelect('amount', 'Amount column', true)
              ) : (
                <>
                  {renderColumnSelect('debit', 'Debit (money out) column')}
                  {renderColumnSelect('credit', 'Credit (money in) column')}
                </>
              )}
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={profile.invertAmount}
                onChange={(e) => setProfile((prev) => ({ ...prev, invertAmount: e.target.checked }))}
              />
              <span>
                Invert sign
                <span className="block text-xs text-gray-500">Tick this if the file shows spending as positive numbers. BetterView stores expenses as negative.</span>
              </span>
            </label>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            {renderColumnSelect('account', 'Account column', false, 'None (type a name)')}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="csv-map-default-account">
                Default account{profile.account ? '' : ' *'}
              </label>
              <input
                id="csv-map-default-account"
                type="text"
                className={inputClass}
                placeholder="e.g. Chase Sapphire"
                value={profile.defaultAccount}
                onChange={(e) => setProfile((prev) => ({ ...prev, defaultAccount: e.target.value }))}
              />
              <p className="text-xs text-gray-500 mt-1">Used for rows with no account value.</p>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 p-3 space-y-3 bg-gray-50/60">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={saveFormat} onChange={(e) => setSaveFormat(e.target.checked)} />
              Save this format so future files like this import automatically
            </label>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="csv-map-name">Format name{saveFormat ? ' *' : ''}</label>
              <input
                id="csv-map-name"
                type="text"
                className={inputClass}
                placeholder="e.g. Chase credit card"
                value={profile.name}
                onChange={(e) => setProfile((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
          </section>
        </div>

        <div className="px-4 sm:px-6 py-4 border-t border-gray-100 bg-gray-50 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 border border-transparent rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-70 inline-flex items-center justify-center"
          >
            {isSubmitting ? (
              <><span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />Importing…</>
            ) : 'Import with this mapping'}
          </button>
        </div>
      </div>
    </div>
  );
}
