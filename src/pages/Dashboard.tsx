import { useState, useEffect, useRef } from 'react';
import { CheckCircle, AlertCircle, RefreshCw, Plus, UploadCloud, LogOut, Sparkles, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import DataTable from '../components/DataTable';
import TransactionModal from '../components/TransactionModal';
import SplitTransactionModal from '../components/SplitTransactionModal';
import { useDatabase } from '../DatabaseContext.jsx';
import { useDriveSync } from '../DriveSyncContext.jsx';
import { useAutoSync } from '../useAutoSync.js';
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
import { importCsvToDatabase } from '../csvImporter.js';

const ONBOARDING_DISMISSED_KEY = 'betterview.onboarding.dismissed.v1';
const ONBOARDING_COMPLETED_KEY = 'betterview.onboarding.completed.v1';

export default function Dashboard() {
  const { db, dbName, isReady, error: dbError, notifyDataChanged, lastMutationTime, triggerMutation } = useDatabase() as any;
  const { accessToken, clearAccessToken } = useDriveSync() as any;
  const { syncStatus } = useAutoSync(lastMutationTime, accessToken, db);

  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isImportingCsv, setIsImportingCsv] = useState(false);
  const [alert, setAlert] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [selectedTx, setSelectedTx] = useState<any | null>(null);
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);
  const [splitTx, setSplitTx] = useState<any | null>(null);
  const [isDraggingCsv, setIsDraggingCsv] = useState(false);
  const [isOnboardingDismissed, setIsOnboardingDismissed] = useState(false);
  const [isOnboardingCompleted, setIsOnboardingCompleted] = useState(false);

  useEffect(() => {
    try {
      setIsOnboardingDismissed(window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1');
      setIsOnboardingCompleted(window.localStorage.getItem(ONBOARDING_COMPLETED_KEY) === '1');
    } catch {
      setIsOnboardingDismissed(false);
      setIsOnboardingCompleted(false);
    }
  }, []);

  useEffect(() => {
    if (transactions.length === 0) return;

    setIsOnboardingCompleted(true);
    setIsOnboardingDismissed(true);

    try {
      window.localStorage.setItem(ONBOARDING_COMPLETED_KEY, '1');
      window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1');
    } catch {
      // Ignore localStorage write failures.
    }
  }, [transactions.length]);

  const dismissOnboarding = () => {
    setIsOnboardingDismissed(true);
    try {
      window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1');
    } catch {
      // Ignore localStorage write failures.
    }
  };

  const markMutation = () => {
    notifyDataChanged();
    triggerMutation();
  };

  const cloudSyncLabel = (() => {
    if (!lastMutationTime) return 'Cloud Connected ✅';
    if (syncStatus === 'pending') return 'Unsaved changes...';
    if (syncStatus === 'syncing') return 'Saving to Drive...';
    if (syncStatus === 'synced') return 'Cloud Synced ✅';
    return 'Cloud Connected ✅';
  })();

  const shouldShowOnboarding = !isLoading && transactions.length === 0 && !isOnboardingCompleted && !isOnboardingDismissed;

  const fetchTransactions = async () => {
    if (!db) {
      setTransactions([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const rows = await getTransactions(db);
      setTransactions(rows);
    } catch (err) {
      console.error(err);
      setAlert({ type: 'error', message: 'Failed to read transactions from local database.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isReady || !db) return;

    const initializeDb = async () => {
      try {
        await bootstrapSchema(db);
        await fetchTransactions();
      } catch (err) {
        console.error(err);
        setAlert({ type: 'error', message: 'Failed to initialize local database schema.' });
        setIsLoading(false);
      }
    };

    initializeDb();
  }, [db, isReady, dbName]);

  useEffect(() => {
    if (dbError) {
      setAlert({ type: 'error', message: dbError });
    }
  }, [dbError]);

  const importCsvFile = async (file: File | null | undefined) => {
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.csv')) {
      setAlert({ type: 'error', message: 'Please select a .csv file.' });
      return;
    }

    try {
      setIsImportingCsv(true);
      setAlert(null);
      const result = await importCsvToDatabase(file, db);
      markMutation();
      await fetchTransactions();
      setAlert({
        type: 'success',
        message: `Imported ${result.inserted} transactions. Skipped ${result.duplicates} duplicates.`,
      });
    } catch (err) {
      console.error(err);
      setAlert({ type: 'error', message: 'Failed to import Fidelity CSV.' });
    } finally {
      setIsImportingCsv(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await importCsvFile(e.target.files?.[0]);
  };

  const handleDropCsv = async (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDraggingCsv(false);
    const droppedFile = e.dataTransfer.files?.[0];
    await importCsvFile(droppedFile);
  };

  const handleToggleOverride = async (id: number, status: number | null) => {
    if (!db) return;

    try {
      await overrideTransaction(db, id, status);
      setTransactions(prev => prev.map((tx: any) =>
        tx.id === id ? {
          ...tx,
          manual_override: status,
          is_excluded: status === 1 ? true : status === 0 ? false : tx.is_excluded
        } : tx
      ));
      markMutation();
    } catch (err) {
      console.error(err);
      setAlert({ type: 'error', message: 'Failed to update transaction manual override.' });
    }
  };

  const handleCreateOrUpdate = async (formData: any) => {
    if (!db) {
      throw new Error('Load a local database first.');
    }

    try {
      if (modalMode === 'create') {
        const payload = { ...formData, manual_override: 0 };
        await createTransaction(db, payload);
        setAlert({ type: 'success', message: 'Transaction created successfully.' });
      } else {
        const payload = { ...selectedTx, ...formData };
        await updateTransaction(db, selectedTx.id, payload);
        setAlert({ type: 'success', message: 'Transaction updated successfully.' });
      }
      markMutation();
      await fetchTransactions();
    } catch (err: any) {
      console.error(err);
      throw new Error(err?.message || 'Failed to save transaction.');
    }
  };

  const openEditModal = (tx: any) => {
    setSelectedTx(tx);
    setModalMode('edit');
    setIsModalOpen(true);
  };

  const openCreateModal = () => {
    setSelectedTx(null);
    setModalMode('create');
    setIsModalOpen(true);
  };

  const handleDeleteTransaction = async (tx: any) => {
    if (!db) return;

    const confirmed = window.confirm(
      `Delete this transaction?\n\n${tx.date} | ${tx.description} | $${Math.abs(tx.amount).toFixed(2)}\n\nThis action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      await deleteTransaction(db, tx.id);
      setTransactions(prev => prev.filter((row: any) => row.id !== tx.id));
      markMutation();
      setAlert({ type: 'success', message: 'Transaction deleted successfully.' });
    } catch (err: any) {
      console.error(err);
      setAlert({
        type: 'error',
        message: err?.message || 'Failed to delete transaction.'
      });
    }
  };

  const openSplitModal = (tx: any) => {
    setSplitTx(tx);
    setIsSplitModalOpen(true);
  };

  const handleSplitTransaction = async (payload: { splits: Array<{ description: string; category: string; amount: number }> }) => {
    if (!db || !splitTx) return;
    try {
      await splitTransaction(db, splitTx.id, payload);
      setAlert({ type: 'success', message: 'Transaction split successfully.' });
      markMutation();
      await fetchTransactions();
    } catch (err: any) {
      console.error(err);
      throw new Error(err?.message || 'Failed to split transaction.');
    }
  };

  const handleUndoSplit = async (tx: any) => {
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
      await fetchTransactions();
    } catch (err: any) {
      console.error(err);
      setAlert({
        type: 'error',
        message: err?.message || 'Failed to undo split transaction.',
      });
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Transactions</h1>
          <p className="text-gray-500 mt-1">Manage and view all transactions from your local-first database.</p>
          <p className="text-xs text-gray-500 mt-2">
            Active DB: <span className="font-medium text-gray-700">{dbName || 'In-memory database'}</span>
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex items-center justify-center px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 min-h-[40px]">
            {syncStatus === 'syncing' && (
              <span className="h-4 w-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin mr-2" />
            )}
            <span className="font-medium">{cloudSyncLabel}</span>
          </div>

          <button
            onClick={clearAccessToken}
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg border font-medium transition-colors shadow-sm bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
            title="Logout from Google Drive"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </button>

          <button
            onClick={fetchTransactions}
            className="p-2.5 text-gray-500 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
            title="Refresh transactions"
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
            Upload FullView CSV
          </button>

          <button
            onClick={openCreateModal}
            disabled={!db}
            className="inline-flex items-center justify-center px-5 py-2.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 hover:shadow-md transition-all disabled:opacity-75"
          >
            <Plus className="h-5 w-5 mr-2" />
            New Transaction
          </button>
        </div>
      </div>

      {/* Alert Banner */}
      {alert && (
        <div className={`p-4 rounded-xl flex items-start shadow-sm animate-in fade-in slide-in-from-top-2 ${alert.type === 'success'
          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
          : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
          {alert.type === 'success' ? (
            <CheckCircle className="h-5 w-5 mr-3 mt-0.5 flex-shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="h-5 w-5 mr-3 mt-0.5 flex-shrink-0 text-red-600" />
          )}
          <span className="font-medium text-sm sm:text-base leading-snug">{alert.message}</span>
        </div>
      )}

      {shouldShowOnboarding && (
        <div className="relative overflow-hidden rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-6 shadow-sm">
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
            <div className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-sky-200 bg-white">
              <Sparkles className="h-5 w-5 text-sky-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900">Welcome to BetterView</h2>
              <p className="mt-1 text-sm text-gray-700">
                Your dashboard is ready. Next step: import your first CSV so your transactions and analytics can populate.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/70 bg-white/80 p-4">
              <p className="text-xs font-semibold tracking-wide text-sky-700">STEP 1</p>
              <p className="mt-1 text-sm text-gray-800">Upload a Fidelity FullView CSV from the Upload button or drag-and-drop zone below.</p>
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
        htmlFor="fidelity-csv-dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingCsv(true);
        }}
        onDragLeave={() => setIsDraggingCsv(false)}
        onDrop={handleDropCsv}
        className={`block border-2 border-dashed rounded-xl p-6 transition-colors cursor-pointer ${isDraggingCsv
          ? 'border-primary-500 bg-primary-50'
          : 'border-gray-300 bg-white/70 hover:bg-white'
          }`}
      >
        <input
          id="fidelity-csv-dropzone"
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleCsvUpload}
        />
        <div className="text-center">
          <UploadCloud className="h-8 w-8 text-gray-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-800">Drag and drop a Fidelity CSV, or click to browse</p>
          <p className="text-xs text-gray-500 mt-1">Overlapping uploads are deduplicated by date + description + amount.</p>
        </div>
      </label>

      {/* Main Table Area */}
      <div className="space-y-4">
        <DataTable
          title="Transactions"
          data={transactions}
          isLoading={isLoading && transactions.length === 0}
          onToggleOverride={handleToggleOverride}
          onEdit={openEditModal}
          onSplit={openSplitModal}
          onUndoSplit={handleUndoSplit}
          onDelete={handleDeleteTransaction}
        />
      </div>

      <TransactionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        mode={modalMode}
        initialData={selectedTx}
        onSubmit={handleCreateOrUpdate}
      />

      <SplitTransactionModal
        isOpen={isSplitModalOpen}
        transaction={splitTx}
        onClose={() => setIsSplitModalOpen(false)}
        onSubmit={handleSplitTransaction}
      />
    </div>
  );
}
