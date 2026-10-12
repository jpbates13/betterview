import type { ParsedNetWorth } from '../types';

export function parseFidelityNetWorth(text: string, options?: { today?: string }): ParsedNetWorth | null;
export function parseNetWorthHistory(text: string): { points: { date: string; netWorth: number }[]; skipped: string[] };
export function parseHistoryJson(text: string): { points: { date: string; netWorth: number }[]; skipped: string[] } | null;
