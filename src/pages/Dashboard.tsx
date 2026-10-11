import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { CheckCircle, AlertCircle, RefreshCw, Plus, UploadCloud, Sparkles, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import DataTable from '../components/DataTable';
import TransactionModal from '../components/TransactionModal';
import SplitTransactionModal from '../components/SplitTransactionModal';
import CsvMappingModal from '../components/transactions/CsvMappingModal';
import ImportResultsPanel from '../components/transactions/ImportResultsPanel';
import BulkActionBar from '../components/transactions/BulkActionBar';
import { errorMessage } from '../components/planning/shared';
import type { CsvProfile, DbApi, ImportSummary, Transaction } from '../types';
import { useDatabase } from '../useDatabase';
import {
  bootstrapSchema,
  createTransaction,
  deleteTransaction,
  getTransactions,
  overrideTransaction,
  splitTransaction,
  undoSplitTransaction,
  updateTransaction,
} from '../dbQueries.js';
import { CsvMappingRequiredError, importCsvToDatabase, saveCsvProfile, undoImportBatch } from '../csvImporter.js';
import {
  addTagToTransactions,
  bulkDelete,
  bulkSetCategory,
  bulkSetOverride,
  removeTagFromTransactions,
} from '../db/features.js';

const ONBOARDING_DISMISSED_KEY = 'betterview.onboarding.dismissed.v1';
const ONBOARDING_COMPLETED_KEY = 'betterview.onboarding.completed.v1';

type Alert = { type: 'success' | 'error'; message: string };
type FormData = Pick<Transaction, 'date' | 'description' | 'amount' | 'category' | 'account'> & {
  source_file?: string;
  manual_override?: number | null;
  tags: string[];
};
type MappingRequest = { file: File; headers: string[]; sampleRows: Array<Record<string, unknown>> };

// bootstrapSchema has no guard against two overlapping runs on a fresh database (both try the
// same ALTER TABLE), which React's dev double-mount triggers. Share one run per database here.
const schemaReady = new WeakMap<object, Promise<void>>();
const ensureSchema = (db: DbApi) => {
  let pending = schemaReady.get(db);
  if (!pending) {
    pending = Promise.resolve(bootstrapSchema(db)).catch((err) => {
      schemaReady.delete(db);
      throw err;
    });
    schemaReady.set(db, pending);
  }
  return pending;
};

const readFlag = (key: string) => {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

const writeFlag = (key: string) => {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    // Ignore localStorage write failures.
  }
};

// The merchant (or failing that, description) every selected row shares, else the first row's.
const commonMatchValue = (rows: Transaction[]): string => {
  const shared = (pick: (tx: Transaction) => string | null | undefined) => {
    const values = new Set(rows.map((tx) => (pick(tx) || '').trim().toLowerCase()));
    return values.size === 1 && !values.has('') ? (pick(rows[0]) || '').trim() : null;
  };
  return shared((tx) => tx.merchant) ?? shared((tx) => tx.description) ?? (rows[0]?.merchant || rows[0]?.description || '').trim();
};

export default function Dashboard() {
  const { db, dbName, isReady, error: dbError, dataVersion, notifyDataChanged, triggerMutation } = useDatabase();
  const navigate = useNavigate();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isImportingCsv, setIsImportingCsv] = useState(false);
  const [alert, setAlert] = useState<Alert | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);
  const [splitTx, setSplitTx] = useState<Transaction | null>(null);
  const [isDraggingCsv, setIsDraggingCsv] = useState(false);
  const [isOnboardingDismissed, setIsOnboardingDismissed] = useState(() => readFlag(ONBOARDING_DISMISSED_KEY));
  const [isOnboardingCompleted] = useState(() => readFlag(ONBOARDING_COMPLETED_KEY));
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [batchFilter, setBatchFilter] = useState<string | null>(null);
  const [mappingRequest, setMappingRequest] = useState<MappingRequest | null>(null);

  // Once there's data, onboarding is done for good.
  useEffect(() => {
    if (transactions.length === 0) return;
    writeFlag(ONBOARDING_COMPLETED_KEY);
    writeFlag(ONBOARDING_DISMISSED_KEY);
  }, [transactions.length]);

  // Success messages fade on their own; errors stay until dismissed.
  useEffect(() => {
    if (alert?.type !== 'success') return;
    const timer = window.setTimeout(() => setAlert(null), 6000);
    return () => window.clearTimeout(timer);
  }, [alert]);

  const dismissOnboarding = () => {
    setIsOnboardingDismissed(true);
    writeFlag(ONBOARDING_DISMISSED_KEY);
  };

  // Every mutation bumps dataVersion, which refetches below, and schedules a Drive sync.
  const markMutation = useCallback(() => {
    notifyDataChanged();
    triggerMutation();
  }, [notifyDataChanged, triggerMutation]);

  useEffect(() => {
    if (!isReady || !db) return;
    let cancelled = false;

    (async () => {
      try {
        await ensureSchema(db);
        const rows = await getTransactions(db, batchFilter ? { importBatchId: batchFilter } : undefined);
        if (cancelled) return;
        setTransactions(rows);
        setLoadError(null);
      } catch (err) {
        console.error(err);
        if (!cancelled) setLoadError(errorMessage(err, 'Failed to read transactions from the local database.'));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, isReady, dbName, dataVersion, batchFilter, refreshKey]);

  const refresh = () => {
    setIsLoading(true);
    setRefreshKey((k) => k + 1);
  };

  const shouldShowOnboarding = !isLoading && transactions.length === 0 && !batchFilter && !isOnboardingCompleted && !isOnboardingDismissed;
  const visibleError = alert?.type === 'error' ? alert.message : null;
  const pageError = dbError || loadError;

  const categories = useMemo(
    () => Array.from(new Set(transactions.map((tx) => tx.category).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [transactions],
  );
  const allTags = useMemo(
    () => Array.from(new Set(transactions.flatMap((tx) => tx.tags || []))).sort(),
    [transactions],
  );

  // ── CSV import ─────────────────────────────────────────────────────────────

  const runImport = async (file: File, options?: { profile: CsvProfile }) => {
    const summary = await importCsvToDatabase(file, db, options);
    setImportSummary(summary);
    setBatchFilter(null);
    setAlert(null);
    if (summary.inserted > 0) markMutation();
  };

  const importCsvFile = async (file: File | null | undefined) => {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setAlert({ type: 'error', message: 'Please select a .csv file.' });
      return;
    }
    if (!db) {
      setAlert({ type: 'error', message: 'The local database is still loading. Try again in a moment.' });
      return;
    }

    try {
      setIsImportingCsv(true);
      setAlert(null);
      await runImport(file);
    } catch (err) {
      if (err instanceof CsvMappingRequiredError) {
        setMappingRequest({
          file,
          headers: err.headers,
          sampleRows: err.sampleRows,
        });
      } else {
        console.error(err);
        setAlert({ type: 'error', message: `Import failed: ${errorMessage(err, 'unknown error')}` });
      }
    } finally {
      setIsImportingCsv(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleMappingConfirm = async (profile: CsvProfile, saveProfile: boolean) => {
    if (!mappingRequest || !db) return;
    if (saveProfile) {
      await saveCsvProfile(db, profile);
      triggerMutation();
    }
    await runImport(mappingRequest.file, { profile });
    setMappingRequest(null);
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    await importCsvFile(file);
  };

  const handleDropCsv = async (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDraggingCsv(false);
    await importCsvFile(e.dataTransfer.files?.[0]);
  };

  const handleUndoImport = async () => {
    if (!db || !importSummary) return;
    const confirmed = window.confirm(
      `Undo the import of ${importSummary.fileName}?\n\nThis removes the ${importSummary.inserted} transaction(s) it added, including any edits, tags and splits made to them since.`,
    );
    if (!confirmed) return;
    try {
      const removed = await undoImportBatch(db, importSummary.batchId);
      setImportSummary(null);
      setBatchFilter(null);
      markMutation();
      setAlert({ type: 'success', message: `Import undone. Removed ${removed} transaction(s).` });
    } catch (err) {
      console.error(err);
      setAlert({ type: 'error', message: errorMessage(err, 'Failed to undo the import.') });
    }
  };

  // ── Single-row actions ─────────────────────────────────────────────────────

  const handleToggleOverride = async (id: number, status: number | null) => {
    if (!db) return;

    try {
      await overrideTransaction(db, id, status);
      setTransactions(prev => prev.map((tx) =>
        tx.id === id ? {
          ...tx,
          manual_override: status,
          is_excluded: status === 1 ? true : status === 0 ? false : tx.is_excluded
        } : tx
      ));
      markMutation();
    } catch (err) {
      console.error(err);
      setAlert({ type: 'error', message: errorMessage(err, 'Failed to update transaction manual override.') });
    }
  };

  const handleCreateOrUpdate = async (formData: FormData) => {
    if (!db) {
      throw new Error('Load a local database first.');
    }

    const { tags: _tags, ...fields } = formData;
    void _tags; // Saved by the modal once the row exists.
    let savedId: number | undefined;
    if (modalMode === 'create') {
      const result = await createTransaction(db, { ...fields, manual_override: 0 });
      savedId = Number(result.id);
      setAlert({ type: 'success', message: 'Transaction created successfully.' });
    } else if (selectedTx) {
      await updateTransaction(db, selectedTx.id, { ...selectedTx, ...fields });
      savedId = selectedTx.id;
      setAlert({ type: 'success', message: 'Transaction updated successfully.' });
    }
    markMutation();
    return { id: savedId };
  };

  const openEditModal = (tx: Transaction) => {
    setSelectedTx(tx);
    setModalMode('edit');
    setIsModalOpen(true);
  };

  const openCreateModal = () => {
    setSelectedTx(null);
    setModalMode('create');
    setIsModalOpen(true);
  };

  const handleDeleteTransaction = async (tx: Transaction) => {
    if (!db) return;

    const confirmed = window.confirm(
      `Delete this transaction?\n\n${tx.date} | ${tx.description} | $${Math.abs(tx.amount).toFixed(2)}\n\nThis action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      await deleteTransaction(db, tx.id);
      setTransactions(prev => prev.filter((row) => row.id !== tx.id));
      markMutation();
      setAlert({ type: 'success', message: 'Transaction deleted successfully.' });
    } catch (err) {
      console.error(err);
      setAlert({ type: 'error', message: errorMessage(err, 'Failed to delete transaction.') });
    }
  };

  const openSplitModal = (tx: Transaction) => {
    setSplitTx(tx);
    setIsSplitModalOpen(true);
  };

  const handleSplitTransaction = async (payload: { splits: Array<{ description: string; category: string; amount: number }> }) => {
    if (!db || !splitTx) return;
    try {
      await splitTransaction(db, splitTx.id, payload);
      setAlert({ type: 'success', message: 'Transaction split successfully.' });
      markMutation();
    } catch (err) {
      console.error(err);
      throw new Error(errorMessage(err, 'Failed to split transaction.'));
    }
  };

  const handleUndoSplit = async (tx: Transaction) => {
    if (!db) return;

    const amountText = Math.abs(Number(tx.amount || 0)).toFixed(2);
    const confirmed = window.confirm(
      `Undo split for this transaction group?\n\n${tx.date} | ${tx.description} | $${amountText}\n\nThis will remove split child rows and restore the original parent transaction.`
    );
    if (!confirmed) return;

    try {
      await undoSplitTransaction(db, tx.id);
      setAlert({ type: 'success', message: 'Split transaction was successfully undone.' });
      markMutation();
    } catch (err) {
      console.error(err);
      setAlert({ type: 'error', message: errorMessage(err, 'Failed to undo split transaction.') });
    }
  };

  // ── Bulk actions ───────────────────────────────────────────────────────────

  const runBulk = async (action: (db: DbApi) => Promise<string>, fallbackError: string) => {
    if (!db) return false;
    try {
      const message = await action(db);
      markMutation();
      setAlert({ type: 'success', message });
      return true;
    } catch (err) {
      console.error(err);
      setAlert({ type: 'error', message: errorMessage(err, fallbackError) });
      return false;
    }
  };

  const plural = (n: number) => `${n.toLocaleString()} transaction${n === 1 ? '' : 's'}`;

  const renderBulkBar = (selected: Transaction[], clearSelection: () => void) => (
    <BulkActionBar
      selected={selected}
      categories={categories}
      allTags={allTags}
      onClear={clearSelection}
      onSetCategory={async (rows, category) => {
        // Split halves stay in step with their original; they're skipped, not changed.
        const editable = rows.filter((tx) => !tx.is_split);
        if (editable.length === 0) {
          setAlert({ type: 'error', message: 'Only split halves are selected. Undo the split before changing their category.' });
          return;
        }
        await runBulk(async (db) => {
          await bulkSetCategory(db, editable.map((tx) => tx.id), category);
          const skipped = rows.length - editable.length;
          return `Set ${plural(editable.length)} to "${category}".${skipped ? ` Skipped ${skipped} split half${skipped === 1 ? '' : 's'}.` : ''}`;
        }, 'Failed to set the category.');
      }}
      onSetOverride={async (rows, status) => {
        await runBulk(async (db) => {
          await bulkSetOverride(db, rows.map((tx) => tx.id), status);
          const verb = status === 1 ? 'Excluded' : status === 0 ? 'Included' : 'Reset to automatic';
          return `${verb}: ${plural(rows.length)}.`;
        }, 'Failed to update analytics inclusion.');
      }}
      onAddTag={async (rows, tag) => {
        await runBulk(async (db) => {
          await addTagToTransactions(db, rows.map((tx) => tx.id), tag);
          return `Tagged ${plural(rows.length)}.`;
        }, 'Failed to add the tag.');
      }}
      onRemoveTag={async (rows, tag) => {
        await runBulk(async (db) => {
          await removeTagFromTransactions(db, rows.map((tx) => tx.id), tag);
          return `Removed #${tag} from the selection.`;
        }, 'Failed to remove the tag.');
      }}
      onDelete={async (rows) => {
        if (!window.confirm(`Delete ${plural(rows.length)}?\n\nThis action cannot be undone.`)) return;
        const ok = await runBulk(async (db) => {
          await bulkDelete(db, rows.map((tx) => tx.id));
          return `Deleted ${plural(rows.length)}.`;
        }, 'Failed to delete the selection.');
        if (ok) clearSelection();
      }}
      onCreateRule={(rows, category) => {
        const value = commonMatchValue(rows);
        navigate('/rules', {
          state: { ruleDraft: { name: value, column: 'merchant', value, category: category || '' } },
        });
      }}
    />
  );

  const alertBanner = (message: Alert) => (
    <div
      role={message.type === 'error' ? 'alert' : 'status'}
      className={`p-4 rounded-xl flex items-start shadow-sm animate-in fade-in slide-in-from-top-2 ${message.type === 'success'
        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
        : 'bg-red-50 text-red-800 border border-red-200'
        }`}
    >
      {message.type === 'success' ? (
        <CheckCircle className="h-5 w-5 mr-3 mt-0.5 flex-shrink-0 text-emerald-600" />
      ) : (
        <AlertCircle className="h-5 w-5 mr-3 mt-0.5 flex-shrink-0 text-red-600" />
      )}
      <span className="font-medium text-sm sm:text-base leading-snug flex-1 min-w-0 break-words">{message.message}</span>
      <button
        onClick={() => setAlert(null)}
        className="ml-2 p-1 rounded-md opacity-60 hover:opacity-100"
        aria-label="Dismiss message"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Transactions</h1>
          <p className="text-gray-500 mt-1">Manage and view all transactions from your local-first database.</p>
          <p className="text-xs text-gray-500 mt-2">
            Active DB: <span className="font-medium text-gray-700">{dbName || 'In-memory database'}</span>
          </p>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <button
            onClick={refresh}
            className="p-2.5 text-gray-500 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
            title="Refresh transactions"
            aria-label="Refresh transactions"
          >
            <RefreshCw className={`h-5 w-5 ${isLoading && !isImportingCsv ? 'animate-spin' : ''}`} />
          </button>

          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            ref={fileInputRef}
            onChange={handleCsvUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isImportingCsv}
            className="inline-flex items-center justify-center px-4 py-2 bg-white text-gray-700 font-medium rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-75 disabled:shadow-none shadow-sm"
          >
            {isImportingCsv ? (
              <div className="h-5 w-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin mr-2"></div>
            ) : (
              <UploadCloud className="h-4 w-4 mr-2" />
            )}
            Import CSV
          </button>

          <button
            onClick={openCreateModal}
            disabled={!db}
            className="inline-flex items-center justify-center px-4 sm:px-5 py-2.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 hover:shadow-md transition-all disabled:opacity-75"
          >
            <Plus className="h-5 w-5 mr-2" />
            New Transaction
          </button>
        </div>
      </div>

      {pageError && pageError !== visibleError && alertBanner({ type: 'error', message: pageError })}

      {/* Alert banner; pinned so bulk-action results are visible wherever the user has scrolled. */}
      {alert && <div className="sticky top-2 z-40">{alertBanner(alert)}</div>}

      {importSummary && (
        <ImportResultsPanel
          key={importSummary.batchId}
          summary={importSummary}
          isFilteringToBatch={batchFilter === importSummary.batchId}
          onToggleFilter={() => {
            setIsLoading(true);
            setBatchFilter((current) => (current === importSummary.batchId ? null : importSummary.batchId));
          }}
          onUndo={handleUndoImport}
          onDismiss={() => {
            setImportSummary(null);
            if (batchFilter) {
              setIsLoading(true);
              setBatchFilter(null);
            }
          }}
        />
      )}

      {shouldShowOnboarding && (
        <div className="relative overflow-hidden rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-4 sm:p-6 shadow-sm">
          <div className="absolute right-3 top-3">
            <button
              onClick={dismissOnboarding}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-white/70 hover:text-gray-700 transition-colors"
              title="Dismiss onboarding"
              aria-label="Dismiss onboarding"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-start gap-4">
            <div className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-white">
              <Sparkles className="h-5 w-5 text-sky-600" />
            </div>
            <div className="min-w-0 pr-6">
              <h2 className="text-lg font-semibold text-gray-900">Welcome to BetterView</h2>
              <p className="mt-1 text-sm text-gray-700">
                Your dashboard is ready. Next step: import your first CSV so your transactions and analytics can populate.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/70 bg-white/80 p-4">
              <p className="text-xs font-semibold tracking-wide text-sky-700">STEP 1</p>
              <p className="mt-1 text-sm text-gray-800">Import a CSV from your bank or card (Fidelity is recognised automatically; other formats you map once).</p>
            </div>
            <div className="rounded-xl border border-white/70 bg-white/80 p-4">
              <p className="text-xs font-semibold tracking-wide text-sky-700">STEP 2</p>
              <p className="mt-1 text-sm text-gray-800">Create rules to auto-categorize future imports and save cleanup time.</p>
            </div>
            <div className="rounded-xl border border-white/70 bg-white/80 p-4">
              <p className="text-xs font-semibold tracking-wide text-sky-700">STEP 3</p>
              <p className="mt-1 text-sm text-gray-800">Review Analytics once imported data is synced to your cloud DB.</p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isImportingCsv}
              className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-sky-600 text-white font-medium hover:bg-sky-700 transition-colors disabled:opacity-70"
            >
              <UploadCloud className="h-4 w-4 mr-2" />
              Import first CSV
            </button>
            <Link
              to="/rules"
              className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-sky-200 text-sky-800 bg-white hover:bg-sky-50 transition-colors font-medium"
            >
              Set up rules
            </Link>
          </div>
        </div>
      )}

      <label
        htmlFor="csv-dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingCsv(true);
        }}
        onDragLeave={() => setIsDraggingCsv(false)}
        onDrop={handleDropCsv}
        className={`block border-2 border-dashed rounded-xl p-4 sm:p-6 transition-colors cursor-pointer ${isDraggingCsv
          ? 'border-primary-500 bg-primary-50'
          : 'border-gray-300 bg-white/70 hover:bg-white'
          }`}
      >
        <input
          id="csv-dropzone"
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleCsvUpload}
        />
        <div className="text-center">
          <UploadCloud className="h-8 w-8 text-gray-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-800">Drag and drop a CSV, or click to browse</p>
          <p className="text-xs text-gray-500 mt-1">Re-importing overlapping files is safe: rows already imported are skipped, and repeats within a file (two identical fares in a day) are kept.</p>
        </div>
      </label>

      {/* Main Table Area */}
      <div className="space-y-4">
        <DataTable
          title={batchFilter ? 'Transactions from this import' : 'Transactions'}
          data={transactions}
          isLoading={isLoading && transactions.length === 0}
          onToggleOverride={handleToggleOverride}
          onEdit={openEditModal}
          onSplit={openSplitModal}
          onUndoSplit={handleUndoSplit}
          onDelete={handleDeleteTransaction}
          renderBulkBar={renderBulkBar}
          emptyMessage={batchFilter ? 'Nothing from this import is left.' : undefined}
        />
      </div>

      <TransactionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        mode={modalMode}
        initialData={selectedTx}
        onSubmit={handleCreateOrUpdate}
        categories={categories}
      />

      <SplitTransactionModal
        isOpen={isSplitModalOpen}
        transaction={splitTx}
        onClose={() => setIsSplitModalOpen(false)}
        onSubmit={handleSplitTransaction}
      />

      {mappingRequest && (
        <CsvMappingModal
          fileName={mappingRequest.file.name}
          headers={mappingRequest.headers}
          sampleRows={mappingRequest.sampleRows}
          onCancel={() => setMappingRequest(null)}
          onConfirm={handleMappingConfirm}
        />
      )}
    </div>
  );
}
