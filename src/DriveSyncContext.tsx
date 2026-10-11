import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DriveSyncContext, type DriveSyncContextValue, type GoogleTokenResponse } from './useDriveSync';

const DRIVE_AUTH_STORAGE_KEY = 'betterview_drive_auth';

// Kept in sessionStorage (this tab only, gone when it closes) rather than localStorage.
const authStorage = () => window.sessionStorage;

type DriveAuth = { accessToken: string; tokenExpiresAt: number };

const SIGNED_OUT: DriveAuth = { accessToken: '', tokenExpiresAt: 0 };

const clearStoredDriveAuth = () => {
  try {
    authStorage().removeItem(DRIVE_AUTH_STORAGE_KEY);
    localStorage.removeItem(DRIVE_AUTH_STORAGE_KEY); // left by older versions
  } catch {
    // Ignore storage failures.
  }
};

const persistDriveAuth = ({ access_token, expires_at }: { access_token: string; expires_at: number }) => {
  authStorage().setItem(
    DRIVE_AUTH_STORAGE_KEY,
    JSON.stringify({
      access_token,
      expires_at,
    }),
  );
};

// Read once on mount, so a reload with a live token never shows the login screen first.
const restoreDriveAuth = (): DriveAuth => {
  try {
    localStorage.removeItem(DRIVE_AUTH_STORAGE_KEY); // left by older versions
    const raw = authStorage().getItem(DRIVE_AUTH_STORAGE_KEY);
    if (!raw) return SIGNED_OUT;

    const parsed = JSON.parse(raw);
    const token = parsed?.access_token || '';
    const expiresAt = Number(parsed?.expires_at || 0);

    if (!token || !expiresAt || Date.now() >= expiresAt) {
      clearStoredDriveAuth();
      return SIGNED_OUT;
    }

    return { accessToken: token, tokenExpiresAt: expiresAt };
  } catch (error) {
    console.error('Failed to restore saved Drive auth session:', error);
    clearStoredDriveAuth();
    return SIGNED_OUT;
  }
};

export function DriveSyncProvider({ children }: { children: ReactNode }) {
  const [{ accessToken, tokenExpiresAt }, setAuth] = useState(restoreDriveAuth);

  useEffect(() => {
    if (!accessToken || !tokenExpiresAt) return;

    const timerId = window.setTimeout(() => {
      setAuth(SIGNED_OUT);
      clearStoredDriveAuth();
    }, Math.max(tokenExpiresAt - Date.now(), 0));

    return () => window.clearTimeout(timerId);
  }, [accessToken, tokenExpiresAt]);

  const setTokenFromGoogleResponse = useCallback((tokenResponse: GoogleTokenResponse | null | undefined) => {
    const token = tokenResponse?.access_token || '';
    const expiresIn = Number(tokenResponse?.expires_in || 0);

    if (!token || !expiresIn) {
      setAuth((prev) => ({ ...prev, accessToken: '' }));
      clearStoredDriveAuth();
      return;
    }

    const expiresAt = Date.now() + (expiresIn * 1000);
    setAuth({ accessToken: token, tokenExpiresAt: expiresAt });
    persistDriveAuth({ access_token: token, expires_at: expiresAt });
  }, []);

  const clearAccessToken = useCallback(() => {
    setAuth(SIGNED_OUT);
    clearStoredDriveAuth();
  }, []);

  const value = useMemo<DriveSyncContextValue>(
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
