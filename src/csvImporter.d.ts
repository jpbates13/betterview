import type { CsvProfile, CsvRow, DbApi, ImportBatch, ImportSummary, SkippedRow, TransactionRecord } from './types';

type CsvFileLike = Pick<File, 'name' | 'text'>;

export const parseAmount: (value: unknown) => number | null;
export const DATE_FORMATS: { value: string; label: string }[];
export const parseDateToIso: (value: unknown, format?: string) => string | null;
export function parseCsvFile(file: Pick<File, 'text'>): Promise<{ headers: string[]; rows: CsvRow[] }>;
export const FIDELITY_PROFILE_NAME: string;
export const guessProfile: (headers: string[]) => CsvProfile;
export const validateProfile: (profile: CsvProfile | null | undefined) => string | null;
export function getCsvProfiles(db: DbApi): Promise<Array<CsvProfile & { id: number }>>;
export function saveCsvProfile(db: DbApi, profile: CsvProfile): Promise<void>;
export function deleteCsvProfile(db: DbApi, profileId: number): Promise<void>;
export function detectProfile(db: DbApi, headers: string[]): Promise<CsvProfile | null>;
export function mapRows(
  rows: CsvRow[],
  profile: CsvProfile,
  fileName: string,
): { mapped: TransactionRecord[]; skipped: SkippedRow[] };

export class CsvMappingRequiredError extends Error {
  constructor(headers: string[], sampleRows: CsvRow[]);
  headers: string[];
  sampleRows: CsvRow[];
}

export function importCsvToDatabase(
  file: CsvFileLike | null | undefined,
  db: DbApi | null | undefined,
  options?: { profile?: CsvProfile | null },
): Promise<ImportSummary>;
export function getImportBatches(db: DbApi): Promise<ImportBatch[]>;
export function undoImportBatch(db: DbApi, batchId: string): Promise<number>;
