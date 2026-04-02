import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadDbFromBrowser, saveDbToBrowser } from './dbStorage.js';
import {
  createRule as createRuleRecord,
  deleteRule as deleteRuleRecord,
  executeRuleOnDatabase as executeRuleOnDatabaseRecord,
  getRules as getRulesRecord,
  updateRule as updateRuleRecord,
} from './dbQueries.js';

const DatabaseContext = createContext(null);

const createDbApi = (callWorker) => ({
  exec: async (sql) => {
    const response = await callWorker('exec', { sql });
    return response.results || [];
  },
  export: async () => {
    const response = await callWorker('export');
    return response.bytes ? new Uint8Array(response.bytes) : new Uint8Array();
  },
});

export function DatabaseProvider({ children }) {
  const workerRef = useRef(null);
  const pendingRef = useRef(new Map());
  const requestIdRef = useRef(0);

  const [db, setDb] = useState(null);
  const [dbName, setDbName] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState('');
  const [dataVersion, setDataVersion] = useState(0);
  const [lastMutationTime, setLastMutationTime] = useState(null);

  const callWorker = useCallback((action, payload = {}, transfer = []) => {
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

    worker.onmessage = (event) => {
      const { id, ok, data, error: workerError } = event.data || {};
      const pending = pendingRef.current.get(id);
      if (!pending) return;

      pendingRef.current.delete(id);
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
        setError(initError.message || 'Failed to initialize SQL.js worker.');
      }
    })();

    return () => {
      pendingRef.current.forEach(({ reject }) => reject(new Error('Database worker terminated.')));
      pendingRef.current.clear();
      worker.terminate();
      workerRef.current = null;
    };
  }, [callWorker]);

  const loadDatabaseFile = useCallback(async (file) => {
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

  const getRules = useCallback(async (options) => {
    return getRulesRecord(ensureDb(), options);
  }, [ensureDb]);

  const createRule = useCallback(async (rule) => {
    const result = await createRuleRecord(ensureDb(), rule);
    notifyDataChanged();
    triggerMutation();
    return result;
  }, [ensureDb, notifyDataChanged, triggerMutation]);

  const updateRule = useCallback(async (ruleId, rule) => {
    const result = await updateRuleRecord(ensureDb(), ruleId, rule);
    notifyDataChanged();
    triggerMutation();
    return result;
  }, [ensureDb, notifyDataChanged, triggerMutation]);

  const deleteRule = useCallback(async (ruleId) => {
    const result = await deleteRuleRecord(ensureDb(), ruleId);
    notifyDataChanged();
    triggerMutation();
    return result;
  }, [ensureDb, notifyDataChanged, triggerMutation]);

  const executeRuleOnDatabase = useCallback(async (rule) => {
    return executeRuleOnDatabaseRecord(ensureDb(), rule);
  }, [ensureDb]);

  const value = useMemo(() => ({
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
  ]);

  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
}

export function useDatabase() {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error('useDatabase must be used within a DatabaseProvider.');
  }
  return context;
}

export default DatabaseContext;
