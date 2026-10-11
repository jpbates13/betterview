import { createContext, useContext } from 'react';

// The fields read from a Google OAuth token response.
export interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number | string;
}

export interface DriveSyncContextValue {
  accessToken: string;
  tokenExpiresAt: number;
  setTokenFromGoogleResponse: (tokenResponse: GoogleTokenResponse | null | undefined) => void;
  clearAccessToken: () => void;
}

export const DriveSyncContext = createContext<DriveSyncContextValue | null>(null);

export function useDriveSync(): DriveSyncContextValue {
  const context = useContext(DriveSyncContext);
  if (!context) {
    throw new Error('useDriveSync must be used within a DriveSyncProvider.');
  }
  return context;
}
