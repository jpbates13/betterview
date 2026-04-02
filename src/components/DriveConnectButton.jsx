import { CheckCircle2 } from 'lucide-react';
import { useGoogleLogin } from '@react-oauth/google';
import { useDriveSync } from '../DriveSyncContext.jsx';

export default function DriveConnectButton() {
  const { accessToken, setTokenFromGoogleResponse } = useDriveSync();

  const connectGoogleDrive = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/drive.file',
    onSuccess: async (tokenResponse) => {
      setTokenFromGoogleResponse(tokenResponse);
    },
    onError: (errorResponse) => {
      console.error('Google login failed:', errorResponse);
    },
  });

  const isConnected = Boolean(accessToken);

  if (!isConnected) {
    return (
      <button
        onClick={() => connectGoogleDrive()}
        className="inline-flex items-center justify-center px-4 py-2 rounded-lg border font-medium transition-colors shadow-sm bg-white text-gray-700 border-gray-200 hover:bg-gray-50 disabled:opacity-60"
      >
        Connect Google Drive
      </button>
    );
  }

  return (
    <div className="inline-flex items-center justify-center px-4 py-2 rounded-lg border font-medium transition-colors shadow-sm bg-emerald-50 text-emerald-700 border-emerald-200">
      <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-600" />
      Drive Connected
    </div>
  );
}
