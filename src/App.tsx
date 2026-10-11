import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from './components/Layout';
import LoginScreen from './components/LoginScreen.jsx';
import Dashboard from './pages/Dashboard';
import Analytics from './pages/Analytics';
import RulesDashboard from './pages/RulesDashboard.jsx';
import { useDriveSync } from './DriveSyncContext.jsx';
import { useDatabase } from './DatabaseContext.jsx';
import { downloadDbFromDrive, getDriveUserId } from './DriveSyncEngine.js';
import {
  clearDbFromBrowser,
  loadDbOwnerFromBrowser,
  saveDbBytesToBrowser,
  saveDbOwnerToBrowser,
} from './dbStorage.js';
import { AutoSyncContext, clearPendingSync, hasPendingSync, useAutoSync } from './useAutoSync.js';

function DashboardApp() {
  const { accessToken, clearAccessToken } = useDriveSync() as any;
  const {
    db,
    isReady,
    error: dbError,
    lastMutationTime,
    triggerMutation,
    createEmptyDatabase,
    reloadDatabaseFromBrowser,
  } = useDatabase() as any;
  // Mounted here rather than on one page so edits made on any page get uploaded.
  const { syncStatus, flushSync } = useAutoSync(lastMutationTime, accessToken, db);
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
        console.error('Failed to hydrate local DB from Drive after auth:', error);
        hydratedTokenRef.current = '';
        setHydrationError('Could not reach Google Drive to load your database.');
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

  const autoSyncValue = useMemo(() => ({ syncStatus, flushSync, logout }), [syncStatus, flushSync, logout]);

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
