import type { DbApi, NetWorthHistoryPoint, ParsedNetWorth } from '../types';

export function getNetWorthHistory(db: DbApi): Promise<NetWorthHistoryPoint[]>;
export function saveNetWorthSnapshot(db: DbApi, snapshot: ParsedNetWorth): Promise<void>;
export function setNetWorthPoint(
  db: DbApi,
  point: { id?: number | null; date: string; netWorth: number | string },
): Promise<void>;
export function importNetWorthPoints(
  db: DbApi,
  points: ReadonlyArray<{ date: string; netWorth: number }>,
): Promise<{ added: number; updated: number; keptSnapshots: number }>;
export function deleteNetWorthPoint(db: DbApi, id: number): Promise<void>;
export function pointBefore(history: ReadonlyArray<NetWorthHistoryPoint>, daysBack: number): NetWorthHistoryPoint | null;
