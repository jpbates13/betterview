import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import Layout from './components/Layout';
import LoginScreen from './components/LoginScreen.jsx';
import Dashboard from './pages/Dashboard';
import Analytics from './pages/Analytics';
import RulesDashboard from './pages/RulesDashboard.jsx';
import { useDriveSync } from './DriveSyncContext.jsx';
import { useDatabase } from './DatabaseContext.jsx';
import { downloadDbFromDrive } from './DriveSyncEngine.js';
import { clearDbFromBrowser, saveDbBytesToBrowser } from './dbStorage.js';

function DashboardApp() {
  const { accessToken } = useDriveSync();
  const { createEmptyDatabase, reloadDatabaseFromBrowser } = useDatabase() as any;
  const [isHydratingCloudDb, setIsHydratingCloudDb] = useState(true);
  const hydratedTokenRef = useRef('');

  useEffect(() => {
    let isMounted = true;

    const hydrateFromDrive = async () => {
      if (!accessToken) {
        if (isMounted) setIsHydratingCloudDb(false);
        return;
      }

      if (hydratedTokenRef.current === accessToken) {
        if (isMounted) setIsHydratingCloudDb(false);
        return;
      }

      hydratedTokenRef.current = accessToken;
      if (isMounted) setIsHydratingCloudDb(true);

      try {
        // Prevent local data bleed when a different account signs in on this browser.
        await clearDbFromBrowser();
        await createEmptyDatabase();

        const cloudDb = await downloadDbFromDrive(accessToken);
        if (!cloudDb) return;

        await saveDbBytesToBrowser(cloudDb);
        await reloadDatabaseFromBrowser();
      } catch (error) {
        console.error('Failed to hydrate local DB from Drive after auth:', error);
      } finally {
        if (isMounted) setIsHydratingCloudDb(false);
      }
    };

    hydrateFromDrive();

    return () => {
      isMounted = false;
    };
  }, [accessToken, createEmptyDatabase, reloadDatabaseFromBrowser]);

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
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/rules" element={<RulesDashboard />} />
        <Route path="/analytics" element={<Analytics />} />
      </Routes>
    </Layout>
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
