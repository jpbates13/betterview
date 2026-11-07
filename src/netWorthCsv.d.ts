import type { NetWorthWithOutside } from './types';

export function netWorthHistoryToCsv(history: ReadonlyArray<NetWorthWithOutside>): string;
export function netWorthAccountsToCsv(history: ReadonlyArray<NetWorthWithOutside>): string;
export function netWorthFileName(kind: 'history' | 'accounts', today?: Date): string;
