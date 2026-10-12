import { useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle, CalendarRange, Cloud, CloudOff, Database, Home, Landmark, Loader2, LogOut, PieChart,
  RefreshCw, SlidersHorizontal, UploadCloud,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import { useAutoSyncStatus } from '../useAutoSync';
import { useDriveSync } from '../useDriveSync';
import { useDatabase } from '../useDatabase';
import { downloadBytes } from '../download.js';

const navItems = [
  { name: 'Transactions', short: 'Transactions', path: '/', icon: Home },
  { name: 'Rules', short: 'Rules', path: '/rules', icon: SlidersHorizontal },
  { name: 'Analytics', short: 'Analytics', path: '/analytics', icon: PieChart },
  { name: 'Planning', short: 'Planning', path: '/planning', icon: CalendarRange },
  { name: 'Net worth', short: 'Net worth', path: '/net-worth', icon: Landmark },
  { name: 'Data & backups', short: 'Data', path: '/data', icon: Database },
];

function SyncIndicator() {
  const { syncStatus, syncError, retrySync } = useAutoSyncStatus();

  if (syncStatus === 'error') {
    return (
      <div className="flex items-center gap-2 text-xs text-red-700 min-w-0">
        <CloudOff className="h-4 w-4 shrink-0" />
        <span className="truncate" title={syncError}>Sync failed</span>
        <button onClick={() => retrySync()} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-red-200 bg-white hover:bg-red-50 font-medium">
          <RefreshCw className="h-3 w-3" /> Retry
        </button>
      </div>
    );
  }

  const label = {
    pending: 'Unsaved changes',
    syncing: 'Saving to Drive…',
    synced: 'Synced to Drive',
    conflict: 'Sync paused',
  }[syncStatus as string] || 'Drive connected';

  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      {syncStatus === 'syncing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
      <span>{label}</span>
    </div>
  );
}

function Banners() {
  const { syncStatus, syncError, resolveConflict } = useAutoSyncStatus();
  const { tokenExpiresAt, setTokenFromGoogleResponse } = useDriveSync();
  const { exportDatabase } = useDatabase();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timerId = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timerId);
  }, []);

  // Google's implicit flow can't refresh silently without a popup, and browsers block
  // popups that don't come from a click, so ask a few minutes before the token ends.
  const renewSession = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/drive.file',
    prompt: '',
    onSuccess: (tokenResponse) => setTokenFromGoogleResponse(tokenResponse),
    onError: (errorResponse) => console.error('Google session renewal failed:', errorResponse),
  });

  const minutesLeft = tokenExpiresAt ? Math.ceil((tokenExpiresAt - now) / 60_000) : Infinity;

  const downloadLocalCopy = async () => {
    downloadBytes(await exportDatabase(), `betterview-this-device-${new Date().toISOString().slice(0, 10)}.db`);
  };

  return (
    <>
      {syncStatus === 'conflict' && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-medium">Your data changed on another device.</p>
              <p className="mt-1">{syncError} Choose which copy to keep; the other is replaced.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => resolveConflict('mine')} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700">
                  Keep this device's copy
                </button>
                <button onClick={() => resolveConflict('cloud')} className="px-3 py-1.5 rounded-lg border border-amber-300 bg-white font-medium hover:bg-amber-100">
                  Use the Drive copy
                </button>
                <button onClick={downloadLocalCopy} className="px-3 py-1.5 rounded-lg border border-amber-300 bg-white font-medium hover:bg-amber-100">
                  Download this device's copy first
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {minutesLeft <= 5 && minutesLeft > 0 && (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 flex flex-wrap items-center gap-3">
          <span>Your Google session ends in {minutesLeft} min.</span>
          <button onClick={() => renewSession()} className="px-3 py-1.5 rounded-lg bg-primary-600 text-white font-medium hover:bg-blue-700">
            Stay signed in
          </button>
        </div>
      )}
    </>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { logout } = useAutoSyncStatus();

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar (tablet and desktop) */}
      <aside className="hidden md:flex w-64 shrink-0 bg-white border-r border-gray-200 flex-col shadow-sm relative z-10">
        <div className="h-16 flex items-center px-6 border-b border-gray-200">
          <UploadCloud className="h-6 w-6 text-primary-600 mr-3" />
          <div className="leading-tight">
            <span className="block font-bold text-sm tracking-tight text-gray-900">BetterView</span>
            <span className="block text-[11px] text-gray-500">Built out of pure financial spite.</span>
          </div>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center px-4 py-3 rounded-lg transition-all duration-200 ${isActive
                  ? 'bg-primary-50 text-primary-600 font-medium'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
              >
                <Icon className="h-5 w-5 mr-3" />
                {item.name}
              </Link>
            );
          })}
        </nav>
        <div className="px-6 py-3 border-t border-gray-200">
          <SyncIndicator />
        </div>
        <div className="p-4 border-t border-gray-200">
          <button
            onClick={logout}
            className="flex items-center w-full px-4 py-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 rounded-lg transition-colors"
          >
            <LogOut className="h-5 w-5 mr-3" />
            Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Top bar (phones) */}
        <header className="md:hidden h-14 shrink-0 bg-white border-b border-gray-200 flex items-center gap-3 px-4 relative z-10">
          <UploadCloud className="h-5 w-5 text-primary-600" />
          <span className="font-bold text-sm text-gray-900">BetterView</span>
          <div className="ml-auto min-w-0"><SyncIndicator /></div>
          <button onClick={logout} aria-label="Logout" className="p-2 -mr-2 text-gray-500 hover:text-gray-900">
            <LogOut className="h-5 w-5" />
          </button>
        </header>

        <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-transparent to-blue-50/30"></div>
        <div className="flex-1 overflow-y-auto p-4 pb-24 md:p-8 md:pb-8 relative z-0">
          <Banners />
          {children}
        </div>

        {/* Bottom tabs (phones) */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-gray-200 grid grid-cols-6 pb-[env(safe-area-inset-bottom)]">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] ${isActive ? 'text-primary-600 font-medium' : 'text-gray-500'}`}
              >
                <Icon className="h-5 w-5" />
                {item.short}
              </Link>
            );
          })}
        </nav>
      </main>
    </div>
  );
}
