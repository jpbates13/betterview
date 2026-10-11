import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { uploadDbToDrive } from './DriveSyncEngine.js';

const DEBOUNCE_MS = 5000;
const PENDING_SYNC_STORAGE_KEY = 'betterview_sync_pending';

// Survives reloads and logouts so unsynced local edits are never mistaken for a clean copy.
export const hasPendingSync = () => {
  try {
    return localStorage.getItem(PENDING_SYNC_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const setPendingSyncFlag = (isPending) => {
  try {
    if (isPending) {
      localStorage.setItem(PENDING_SYNC_STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(PENDING_SYNC_STORAGE_KEY);
    }
  } catch {
    // Ignore localStorage write failures.
  }
};

export const clearPendingSync = () => setPendingSyncFlag(false);

export const AutoSyncContext = createContext({
  syncStatus: 'idle',
  flushSync: async () => {},
  logout: () => {},
});

export const useAutoSyncStatus = () => useContext(AutoSyncContext);

export function useAutoSync(lastMutationTime, accessToken, db) {
  const [syncStatus, setSyncStatus] = useState('idle');
  const timeoutRef = useRef(null);
  const pendingSyncRef = useRef(false);

  const clearPendingTimer = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const runSyncNow = useCallback(async () => {
    if (!pendingSyncRef.current || !accessToken || !db) {
      return;
    }

    try {
      setSyncStatus('syncing');
      const dbBytes = await db.export();
      await uploadDbToDrive(accessToken, dbBytes);
      pendingSyncRef.current = false;
      setPendingSyncFlag(false);
      setSyncStatus('synced');
    } catch (error) {
      console.error('Auto-sync failed:', error);
      setSyncStatus('pending');
    }
  }, [accessToken, db]);

  const flushSync = useCallback(async () => {
    clearPendingTimer();
    await runSyncNow();
  }, [clearPendingTimer, runSyncNow]);

  useEffect(() => {
    if (!lastMutationTime || !accessToken || !db) {
      return undefined;
    }

    pendingSyncRef.current = true;
    setPendingSyncFlag(true);
    setSyncStatus('pending');
    clearPendingTimer();

    timeoutRef.current = window.setTimeout(() => {
      runSyncNow();
    }, DEBOUNCE_MS);

    return () => {
      clearPendingTimer();
    };
  }, [lastMutationTime, accessToken, db, clearPendingTimer, runSyncNow]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      if (!pendingSyncRef.current) return;

      clearPendingTimer();
      runSyncNow();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [clearPendingTimer, runSyncNow]);

  useEffect(() => () => {
    clearPendingTimer();
  }, [clearPendingTimer]);

  return { syncStatus, flushSync };
}

export default useAutoSync;
