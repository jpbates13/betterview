import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from './components/Layout';
import LoginScreen from './components/LoginScreen.jsx';
import Dashboard from './pages/Dashboard';
import Analytics from './pages/Analytics';
import RulesDashboard from './pages/RulesDashboard.jsx';
import Planning from './pages/Planning';
import DataSettings from './pages/DataSettings';
import { useDriveSync } from './useDriveSync';
import { useDatabase } from './useDatabase';
import { downloadDbFromDrive, getDriveUserId } from './DriveSyncEngine.js';
import { PassphraseRequiredError, unlockWithPassphrase } from './driveCrypto.js';
import PassphrasePrompt from './components/PassphrasePrompt';
import {
  clearDbFromBrowser,
  loadDbOwnerFromBrowser,
  saveDbBytesToBrowser,
  saveDbOwnerToBrowser,
} from './dbStorage.js';
import { AutoSyncContext, clearPendingSync, hasPendingSync, useAutoSync } from './useAutoSync';

function DashboardApp() {
  const { accessToken, tokenExpiresAt, clearAccessToken } = useDriveSync();
  const {
    db,
    isReady,
    error: dbError,
    lastMutationTime,
    triggerMutation,
    createEmptyDatabase,
    reloadDatabaseFromBrowser,
  } = useDatabase();
  // An encrypted Drive copy this device can't open yet; shows the passphrase screen.
  const [lockedCloud, setLockedCloud] = useState<{ bytes: Uint8Array, message: string } | null>(null);

  const replaceWithCloudCopy = useCallback(async () => {
    try {
      const cloudDb = await downloadDbFromDrive(accessToken);
      if (!cloudDb) throw new Error('There is no Drive copy to load.');
      await saveDbBytesToBrowser(cloudDb);
      await reloadDatabaseFromBrowser();
    } catch (error) {
      if (error instanceof PassphraseRequiredError) {
        setLockedCloud({ bytes: error.encryptedBytes, message: error.message });
      }
      throw error;
    }
  }, [accessToken, reloadDatabaseFromBrowser]);

  // Mounted here rather than on one page so edits made on any page get uploaded.
  const { syncStatus, syncError, flushSync, retrySync, resolveConflict } = useAutoSync(
    lastMutationTime,
    accessToken,
    db,
    { onTakeCloud: replaceWithCloudCopy },
  );
  const [isHydratingCloudDb, setIsHydratingCloudDb] = useState(true);
  const [hydrationError, setHydrationError] = useState('');
  const [hydrationAttempt, setHydrationAttempt] = useState(0);
  const hydratedTokenRef = useRef('');
  // Not cancelled on effect cleanup: StrictMode re-runs the effect while the first run is
  // still in flight, and that run must still be the one that finishes hydration.
  const isHydrationInFlightRef = useRef(false);

  useEffect(() => {
    const hydrateFromDrive = async () => {
      if (!accessToken) {
        setIsHydratingCloudDb(false);
        return;
      }

      // Wait for the worker to finish loading the browser copy before touching it.
      if (!isReady) {
        if (dbError) setIsHydratingCloudDb(false);
        return;
      }

      if (hydratedTokenRef.current === accessToken) {
        if (!isHydrationInFlightRef.current) setIsHydratingCloudDb(false);
        return;
      }

      hydratedTokenRef.current = accessToken;
      isHydrationInFlightRef.current = true;
      setIsHydratingCloudDb(true);
      setHydrationError('');

      try {
        const currentOwner = await getDriveUserId(accessToken);
        const isSameOwner = (await loadDbOwnerFromBrowser()) === currentOwner;

        // Local edits that never reached Drive win over the cloud copy; upload them instead.
        if (isSameOwner && hasPendingSync()) {
          triggerMutation();
          return;
        }

        // Download before replacing anything, so a failed request never leaves an empty DB
        // that the next auto-sync would upload over the real cloud copy.
        const cloudDb = await downloadDbFromDrive(accessToken);
        if (cloudDb) {
          await saveDbBytesToBrowser(cloudDb);
          await reloadDatabaseFromBrowser();
        } else if (!isSameOwner) {
          // Prevent local data bleed when a different account signs in on this browser.
          await clearDbFromBrowser();
          await createEmptyDatabase();
        }

        if (!isSameOwner) clearPendingSync();
        await saveDbOwnerToBrowser(currentOwner);
      } catch (error) {
        hydratedTokenRef.current = '';
        if (error instanceof PassphraseRequiredError) {
          setLockedCloud({ bytes: error.encryptedBytes, message: error.message });
          return;
        }
        console.error('Failed to hydrate local DB from Drive after auth:', error);
        const details = error instanceof Error ? ` (${error.message})` : '';
        setHydrationError(`Could not reach Google Drive to load your database${details}.`);
      } finally {
        isHydrationInFlightRef.current = false;
        setIsHydratingCloudDb(false);
      }
    };

    hydrateFromDrive();
  }, [accessToken, isReady, dbError, hydrationAttempt, triggerMutation, createEmptyDatabase, reloadDatabaseFromBrowser]);

  const logout = useCallback(async () => {
    await flushSync();
    clearAccessToken();
  }, [flushSync, clearAccessToken]);

  // Upload pending edits shortly before the Google token runs out.
  useEffect(() => {
    if (!tokenExpiresAt) return undefined;
    const delay = tokenExpiresAt - Date.now() - 60_000;
    if (delay <= 0) return undefined;
    const timerId = window.setTimeout(() => { flushSync(); }, delay);
    return () => window.clearTimeout(timerId);
  }, [tokenExpiresAt, flushSync]);

  const unlockCloudCopy = useCallback(async (passphrase: string) => {
    if (!lockedCloud) return;
    try {
      // Stores the key on this device; then load the Drive copy the normal way.
      await unlockWithPassphrase(lockedCloud.bytes, passphrase);
      setLockedCloud(null);
      setHydrationAttempt((prev) => prev + 1);
    } catch (error) {
      setLockedCloud({ ...lockedCloud, message: error instanceof Error ? error.message : String(error) });
    }
  }, [lockedCloud]);

  const autoSyncValue = useMemo(
    () => ({ syncStatus, syncError, flushSync, retrySync, resolveConflict, logout }),
    [syncStatus, syncError, flushSync, retrySync, resolveConflict, logout],
  );

  if (lockedCloud) {
    return <PassphrasePrompt message={lockedCloud.message} onSubmit={unlockCloudCopy} onLogout={clearAccessToken} />;
  }

  if (hydrationError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-sm text-gray-700 mb-4">{hydrationError} Your local data has not been changed.</p>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => {
                setHydrationError('');
                setHydrationAttempt((prev) => prev + 1);
              }}
              className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 font-medium hover:bg-gray-50"
            >
              Retry
            </button>
            <button
              onClick={clearAccessToken}
              className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 font-medium hover:bg-gray-50"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isHydratingCloudDb) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="h-8 w-8 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-sm text-gray-600">Syncing your latest cloud database...</p>
        </div>
      </div>
    );
  }

  return (
    <AutoSyncContext.Provider value={autoSyncValue}>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/rules" element={<RulesDashboard />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/planning" element={<Planning />} />
          <Route path="/data" element={<DataSettings />} />
        </Routes>
      </Layout>
    </AutoSyncContext.Provider>
  );
}

function App() {
  const { accessToken } = useDriveSync();

  return (
    <Router>
      {accessToken ? <DashboardApp /> : <LoginScreen />}
    </Router>
  );
}

export default App;
