import type { DbApi, QueryExecResult, Row, SqlValue } from '../types';

export const rowify: (execResult: QueryExecResult[] | null | undefined) => Row[];
export const queryRows: (db: DbApi, sql: string, params?: unknown[]) => Promise<Row[]>;
export const scalar: <T = number>(db: DbApi, sql: string, fallback?: T, params?: unknown[]) => Promise<SqlValue | T>;
export const changes: (db: DbApi) => Promise<number>;
export const lastInsertId: (db: DbApi) => Promise<number>;
export const sqlValue: (value: unknown) => string;
export const bindValue: (value: unknown) => unknown;
export const binds: (...values: unknown[]) => unknown[];
export const placeholders: (count: number) => string;
export const toNumber: (value: unknown, fallback?: number) => number;
export const round2: (value: unknown) => number;
export const randomKey: (prefix: string) => string;
export const normalizeText: (value: unknown) => string;
export const normalizeLower: (value: unknown) => string;
export const inTransaction: <T>(db: DbApi, fn: () => Promise<T>) => Promise<T>;
