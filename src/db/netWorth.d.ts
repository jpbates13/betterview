import type { DbApi, NetWorthHistoryPoint, NetWorthWithOutside, OutsideAccount, ParsedNetWorth } from '../types';

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
export function getOutsideAccounts(db: DbApi): Promise<OutsideAccount[]>;
export function setAccountAddsToNetWorth(db: DbApi, account: string, include: boolean): Promise<void>;
export function importAccountBalances(
  db: DbApi,
  account: string,
  points: ReadonlyArray<{ date: string; netWorth: number }>,
): Promise<number>;
export function balanceOn(balances: ReadonlyArray<{ date: string; balance: number }>, date: string): number | null;
export function addOutsideAccounts(history: ReadonlyArray<NetWorthHistoryPoint>, accounts: ReadonlyArray<OutsideAccount>): NetWorthWithOutside[];
