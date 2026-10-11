import type { DbApi } from './types';

export function saveDbToBrowser(db: Pick<DbApi, 'export'> | null | undefined): Promise<Uint8Array>;
export function loadDbFromBrowser(): Promise<Uint8Array<ArrayBuffer> | null>;
export function saveDbBytesToBrowser(bytes: ArrayBuffer | ArrayBufferView | Blob | null | undefined): Promise<Uint8Array>;
export function clearDbFromBrowser(): Promise<void>;
export function loadDbOwnerFromBrowser(): Promise<string | null>;
export function saveDbOwnerToBrowser(owner: string): Promise<void>;
