import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadDbFromBrowser, saveDbToBrowser } from './dbStorage.js';
import {
  createRule as createRuleRecord,
  deleteRule as deleteRuleRecord,
  executeRuleOnDatabase as executeRuleOnDatabaseRecord,
  getAnalyticsSettingsConfig as getAnalyticsSettingsConfigRecord,
  getRules as getRulesRecord,
  updateAnalyticsSettingsConfig as updateAnalyticsSettingsConfigRecord,
  updateRule as updateRuleRecord,
} from './dbQueries.js';
import type { AnalyticsSettingsConfig, DbApi, QueryExecResult, RuleInput } from './types';
import { DatabaseContext, type DatabaseContextValue } from './useDatabase';

type WorkerAction = 'init' | 'new' | 'load' | 'exec' | 'export';

interface WorkerData {
  ready?: boolean;
  loaded?: boolean;
  results?: QueryExecResult[];
  bytes?: Uint8Array;
}

interface PendingRequest {
  resolve: (data: WorkerData) => void;
  reject: (error: Error) => void;
}

type CallWorker = (action: WorkerAction, payload?: Record<string, unknown>, transfer?: Transferable[]) => Promise<WorkerData>;

const createDbApi = (callWorker: CallWorker): DbApi => ({
  exec: async (sql, params) => {
    const response = await callWorker('exec', params ? { sql, params } : { sql });
    return response.results || [];
  },
  export: async () => {
    const response = await callWorker('export');
    return response.bytes ? new Uint8Array(response.bytes) : new Uint8Array();
  },
});

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<string, PendingRequest>());
  const requestIdRef = useRef(0);

  const [db, setDb] = useState<DbApi | null>(null);
  const [dbName, setDbName] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState('');
  const [dataVersion, setDataVersion] = useState(0);
  const [lastMutationTime, setLastMutationTime] = useState<number | null>(null);

  const callWorker = useCallback<CallWorker>((action, payload = {}, transfer = []) => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        reject(new Error('Database worker is not initialized.'));
        return;
      }

      const id = `${Date.now()}-${requestIdRef.current++}`;
      pendingRef.current.set(id, { resolve, reject });
      workerRef.current.postMessage({ id, action, payload }, transfer);
    });
  }, []);

  useEffect(() => {
    const worker = new Worker(new URL('./workers/sqlWorker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const pendingRequests = pendingRef.current;

    worker.onmessage = (event: MessageEvent<{ id: string; ok: boolean; data: WorkerData; error?: string }>) => {
      const { id, ok, data, error: workerError } = event.data || {};
      const pending = pendingRequests.get(id);
      if (!pending) return;

      pendingRequests.delete(id);
      if (ok) {
        pending.resolve(data);
      } else {
        pending.reject(new Error(workerError || 'Worker error'));
      }
    };

    (async () => {
      try {
        setError('');
        const loadedData = await loadDbFromBrowser();
        const transfer = loadedData ? [loadedData.buffer] : [];
        const response = await callWorker('init', loadedData ? { buffer: loadedData.buffer } : {}, transfer);
        const api = createDbApi(callWorker);
        setDb(api);
        setDbName(response?.loaded ? 'Browser-saved database' : 'In-memory database');
        setIsReady(true);
      } catch (initError) {
        setError((initError instanceof Error && initError.message) || 'Failed to initialize SQL.js worker.');
      }
    })();

    return () => {
      pendingRequests.forEach(({ reject }) => reject(new Error('Database worker terminated.')));
      pendingRequests.clear();
      worker.terminate();
      workerRef.current = null;
    };
  }, [callWorker]);

  const loadDatabaseFile = useCallback(async (file: File | null | undefined) => {
    if (!file) return;

    setError('');
    const buffer = await file.arrayBuffer();
    const api = createDbApi(callWorker);
    await callWorker('load', { buffer }, [buffer]);
    await saveDbToBrowser(api);
    setDbName(file.name);
    setDb(api);
    setIsReady(true);
  }, [callWorker]);

  const createEmptyDatabase = useCallback(async () => {
    setError('');
    const api = createDbApi(callWorker);
    await callWorker('new');
    await saveDbToBrowser(api);
    setDbName('In-memory database');
    setDb(api);
    setIsReady(true);
  }, [callWorker]);

  const exportDatabase = useCallback(async () => {
    const api = createDbApi(callWorker);
    return api.export();
  }, [callWorker]);

  const reloadDatabaseFromBrowser = useCallback(async () => {
    setError('');
    const loadedData = await loadDbFromBrowser();
    if (!loadedData) {
      return false;
    }

    await callWorker('load', { buffer: loadedData.buffer }, [loadedData.buffer]);
    // A fresh api object per loaded database, so per-database caches start clean.
    setDb(createDbApi(callWorker));
    setDbName('Browser-saved database');
    setDataVersion((prev) => prev + 1);
    return true;
  }, [callWorker]);

  const notifyDataChanged = useCallback(() => {
    setDataVersion((prev) => prev + 1);
  }, []);

  const triggerMutation = useCallback(() => {
    setLastMutationTime(Date.now());
  }, []);

  const ensureDb = useCallback(() => {
    if (!db) {
      throw new Error('Database is not initialized.');
    }

    return db;
  }, [db]);

  const getRules = useCallback(async (options?: { activeOnly?: boolean }) => {
    return getRulesRecord(ensureDb(), options);
  }, [ensureDb]);

  const createRule = useCallback(async (rule: RuleInput) => {
    const result = await createRuleRecord(ensureDb(), rule);
    notifyDataChanged();
    triggerMutation();
    return result;
  }, [ensureDb, notifyDataChanged, triggerMutation]);

  const updateRule = useCallback(async (ruleId: number, rule: RuleInput) => {
    const result = await updateRuleRecord(ensureDb(), ruleId, rule);
    notifyDataChanged();
    triggerMutation();
    return result;
  }, [ensureDb, notifyDataChanged, triggerMutation]);

  const deleteRule = useCallback(async (ruleId: number) => {
    const result = await deleteRuleRecord(ensureDb(), ruleId);
    notifyDataChanged();
    triggerMutation();
    return result;
  }, [ensureDb, notifyDataChanged, triggerMutation]);

  const executeRuleOnDatabase = useCallback(async (rule: RuleInput) => {
    return executeRuleOnDatabaseRecord(ensureDb(), rule);
  }, [ensureDb]);

  const getAnalyticsSettingsConfig = useCallback(async () => {
    return getAnalyticsSettingsConfigRecord(ensureDb());
  }, [ensureDb]);

  const updateAnalyticsSettingsConfig = useCallback(async (updates: Partial<AnalyticsSettingsConfig>) => {
    const result = await updateAnalyticsSettingsConfigRecord(ensureDb(), updates);
    notifyDataChanged();
    triggerMutation();
    return result;
  }, [ensureDb, notifyDataChanged, triggerMutation]);

  const value = useMemo<DatabaseContextValue>(() => ({
    db,
    dbName,
    isReady,
    error,
    dataVersion,
    lastMutationTime,
    loadDatabaseFile,
    createEmptyDatabase,
    exportDatabase,
    reloadDatabaseFromBrowser,
    notifyDataChanged,
    triggerMutation,
    getRules,
    createRule,
    updateRule,
    deleteRule,
    executeRuleOnDatabase,
    getAnalyticsSettingsConfig,
    updateAnalyticsSettingsConfig,
  }), [
    db,
    dbName,
    isReady,
    error,
    dataVersion,
    lastMutationTime,
    loadDatabaseFile,
    createEmptyDatabase,
    exportDatabase,
    reloadDatabaseFromBrowser,
    notifyDataChanged,
    triggerMutation,
    getRules,
    createRule,
    updateRule,
    deleteRule,
    executeRuleOnDatabase,
    getAnalyticsSettingsConfig,
    updateAnalyticsSettingsConfig,
  ]);

  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
}
