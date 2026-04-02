import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const DriveSyncContext = createContext(null);
const DRIVE_AUTH_STORAGE_KEY = 'betterview_drive_auth';

const clearStoredDriveAuth = () => {
  localStorage.removeItem(DRIVE_AUTH_STORAGE_KEY);
};

const persistDriveAuth = ({ access_token, expires_at }) => {
  localStorage.setItem(
    DRIVE_AUTH_STORAGE_KEY,
    JSON.stringify({
      access_token,
      expires_at,
    }),
  );
};

export function DriveSyncProvider({ children }) {
  const [accessToken, setAccessToken] = useState('');
  const [tokenExpiresAt, setTokenExpiresAt] = useState(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRIVE_AUTH_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      const token = parsed?.access_token || '';
      const expiresAt = Number(parsed?.expires_at || 0);

      if (!token || !expiresAt || Date.now() >= expiresAt) {
        clearStoredDriveAuth();
        return;
      }

      setAccessToken(token);
      setTokenExpiresAt(expiresAt);
    } catch (error) {
      console.error('Failed to restore saved Drive auth session:', error);
      clearStoredDriveAuth();
    }
  }, []);

  useEffect(() => {
    if (!accessToken || !tokenExpiresAt) return;

    const remainingMs = tokenExpiresAt - Date.now();
    if (remainingMs <= 0) {
      setAccessToken('');
      setTokenExpiresAt(0);
      clearStoredDriveAuth();
      return;
    }

    const timerId = window.setTimeout(() => {
      setAccessToken('');
      setTokenExpiresAt(0);
      clearStoredDriveAuth();
    }, remainingMs);

    return () => window.clearTimeout(timerId);
  }, [accessToken, tokenExpiresAt]);

  const setTokenFromGoogleResponse = useCallback((tokenResponse) => {
    const token = tokenResponse?.access_token || '';
    const expiresIn = Number(tokenResponse?.expires_in || 0);

    if (!token || !expiresIn) {
      setAccessToken('');
      clearStoredDriveAuth();
      return;
    }

    const expiresAt = Date.now() + (expiresIn * 1000);
    setAccessToken(token);
    setTokenExpiresAt(expiresAt);
    persistDriveAuth({ access_token: token, expires_at: expiresAt });
  }, []);

  const clearAccessToken = useCallback(() => {
    setAccessToken('');
    setTokenExpiresAt(0);
    clearStoredDriveAuth();
  }, []);

  const value = useMemo(
    () => ({
      accessToken,
      tokenExpiresAt,
      setTokenFromGoogleResponse,
      clearAccessToken,
    }),
    [accessToken, tokenExpiresAt, clearAccessToken, setTokenFromGoogleResponse],
  );

  return <DriveSyncContext.Provider value={value}>{children}</DriveSyncContext.Provider>;
}

export function useDriveSync() {
  const context = useContext(DriveSyncContext);
  if (!context) {
    throw new Error('useDriveSync must be used within a DriveSyncProvider.');
  }
  return context;
}

export default DriveSyncContext;
