import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { DriveConflictError, uploadDbToDrive } from './DriveSyncEngine.js';

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
  syncError: '',
  flushSync: async () => {},
  retrySync: async () => {},
  resolveConflict: async () => {},
  logout: () => {},
});

export const useAutoSyncStatus = () => useContext(AutoSyncContext);

// syncStatus: idle | pending | syncing | synced | error | conflict.
// onTakeCloud replaces the local DB with the Drive copy when a conflict is resolved that way.
export function useAutoSync(lastMutationTime, accessToken, db, { onTakeCloud } = {}) {
  const [syncStatus, setSyncStatus] = useState('idle');
  const [syncError, setSyncError] = useState('');
  const timeoutRef = useRef(null);
  const pendingSyncRef = useRef(false);

  const clearPendingTimer = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const conflictRef = useRef(false);

  const runSyncNow = useCallback(async ({ force = false } = {}) => {
    if (!pendingSyncRef.current || !accessToken || !db) {
      return;
    }
    // A conflict waits for the user's choice rather than retrying on every edit.
    if (conflictRef.current && !force) return;

    try {
      setSyncStatus('syncing');
      const dbBytes = await db.export();
      await uploadDbToDrive(accessToken, dbBytes, { force });
      pendingSyncRef.current = false;
      conflictRef.current = false;
      setPendingSyncFlag(false);
      setSyncError('');
      setSyncStatus('synced');
    } catch (error) {
      console.error('Auto-sync failed:', error);
      if (error instanceof DriveConflictError) {
        conflictRef.current = true;
        setSyncStatus('conflict');
        setSyncError(error.message);
        return;
      }
      setSyncStatus('error');
      setSyncError(error instanceof Error ? error.message : String(error));
    }
  }, [accessToken, db]);

  const retrySync = useCallback(async () => {
    pendingSyncRef.current = true;
    await runSyncNow();
  }, [runSyncNow]);

  const resolveConflict = useCallback(async (choice) => {
    if (choice === 'mine') {
      pendingSyncRef.current = true;
      await runSyncNow({ force: true });
      return;
    }
    if (choice === 'cloud' && onTakeCloud) {
      setSyncStatus('syncing');
      try {
        await onTakeCloud();
        pendingSyncRef.current = false;
        conflictRef.current = false;
        setPendingSyncFlag(false);
        setSyncError('');
        setSyncStatus('synced');
      } catch (error) {
        setSyncStatus('conflict');
        setSyncError(error instanceof Error ? error.message : String(error));
      }
    }
  }, [onTakeCloud, runSyncNow]);

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
    if (!conflictRef.current) setSyncStatus('pending');
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

  // Warn before closing the tab while edits haven't reached Drive.
  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!pendingSyncRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => () => {
    clearPendingTimer();
  }, [clearPendingTimer]);

  return { syncStatus, syncError, flushSync, retrySync, resolveConflict };
}

export default useAutoSync;
