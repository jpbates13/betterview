import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { DriveConflictError, uploadDbToDrive } from './DriveSyncEngine.js';
import type { DbApi } from './types';

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

const setPendingSyncFlag = (isPending: boolean) => {
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

export type SyncStatus = 'idle' | 'pending' | 'syncing' | 'synced' | 'error' | 'conflict';
export type ConflictChoice = 'mine' | 'cloud';

export interface AutoSyncStatus {
  syncStatus: SyncStatus;
  syncError: string;
  flushSync: () => Promise<void>;
  retrySync: () => Promise<void>;
  resolveConflict: (choice: ConflictChoice) => Promise<void>;
  logout: () => void;
}

export const AutoSyncContext = createContext<AutoSyncStatus>({
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
export function useAutoSync(
  lastMutationTime: number | null,
  accessToken: string,
  db: DbApi | null,
  { onTakeCloud }: { onTakeCloud?: () => Promise<void> } = {},
) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncError, setSyncError] = useState('');
  const timeoutRef = useRef<number | null>(null);
  const pendingSyncRef = useRef(false);

  const clearPendingTimer = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const conflictRef = useRef(false);
  // Bumped on every edit, so an upload only clears "pending" if nothing changed during it.
  const editCountRef = useRef(0);
  const uploadInFlightRef = useRef<Promise<void> | null>(null);

  const runSyncNow = useCallback(async ({ force = false } = {}): Promise<void> => {
    // One upload at a time; a request made during an upload runs after it.
    while (uploadInFlightRef.current) {
      await uploadInFlightRef.current;
    }
    if (!pendingSyncRef.current || !accessToken || !db) {
      return;
    }
    // A conflict waits for the user's choice rather than retrying on every edit.
    if (conflictRef.current && !force) return;

    const editCount = editCountRef.current;
    const upload = (async () => {
      setSyncStatus('syncing');
      const dbBytes = await db.export();
      await uploadDbToDrive(accessToken, dbBytes, { force });
    })();
    uploadInFlightRef.current = upload.catch(() => {}).finally(() => { uploadInFlightRef.current = null; });

    try {
      await upload;
      conflictRef.current = false;
      setSyncError('');
      if (editCountRef.current === editCount) {
        pendingSyncRef.current = false;
        setPendingSyncFlag(false);
        setSyncStatus('synced');
      } else {
        setSyncStatus('pending');
      }
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

  const resolveConflict = useCallback(async (choice: ConflictChoice) => {
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

    editCountRef.current += 1;
    pendingSyncRef.current = true;
    setPendingSyncFlag(true);
    // Mirrors an external event (a database edit) into the sync status; deriving it would
    // need the mutation time threaded through every status change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
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
