import { Cloud, ShieldCheck } from 'lucide-react';
import DriveConnectButton from './DriveConnectButton.jsx';

export default function LoginScreen() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-blue-100 flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-white/95 border border-gray-200 rounded-3xl shadow-xl p-8 sm:p-10 text-center">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-blue-50 border border-blue-100 mb-5">
          <Cloud className="h-7 w-7 text-blue-600" />
        </div>

        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Connect Google Drive to Continue</h1>
        <p className="mt-3 text-gray-600 leading-relaxed">
          BetterView is local-first, but cloud sync is required to enter the dashboard.
          Connect your Google Drive so we can securely sync and restore your database.
        </p>

        <div className="mt-7 flex justify-center">
          <DriveConnectButton />
        </div>

        <div className="mt-6 inline-flex items-center text-xs text-gray-500">
          <ShieldCheck className="h-4 w-4 mr-2 text-emerald-600" />
          Token is stored locally and automatically expires.
        </div>
      </div>
    </div>
  );
}
