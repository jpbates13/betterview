import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadDbToDrive } from './DriveSyncEngine.js';

const DEBOUNCE_MS = 5000;

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
      setSyncStatus('synced');
    } catch (error) {
      console.error('Auto-sync failed:', error);
      setSyncStatus('pending');
    }
  }, [accessToken, db]);

  useEffect(() => {
    if (!lastMutationTime || !accessToken || !db) {
      return undefined;
    }

    pendingSyncRef.current = true;
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

  return { syncStatus };
}

export default useAutoSync;
