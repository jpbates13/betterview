import type { DriveFile } from './types';

export const getKnownDriveVersion: () => string | null;
export const setKnownDriveVersion: (version: string | number | null | undefined) => void;

export class DriveConflictError extends Error {
  constructor(cloudFile: DriveFile);
  cloudFile: DriveFile;
}

export function getDriveUserId(accessToken: string): Promise<string>;
export function downloadDbFromDrive(accessToken: string): Promise<Uint8Array<ArrayBuffer> | null>;
export function uploadDbToDrive(
  accessToken: string,
  dbUint8Array: Uint8Array,
  options?: { force?: boolean },
): Promise<DriveFile>;
export function listDriveBackups(accessToken: string): Promise<DriveFile[]>;
export function downloadDriveBackup(accessToken: string, fileId: string): Promise<Uint8Array<ArrayBuffer>>;
