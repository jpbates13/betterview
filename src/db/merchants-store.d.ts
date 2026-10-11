import type { DbApi, MerchantRule } from '../types';

export function getMerchantRules(db: DbApi): Promise<MerchantRule[]>;
export function refreshMerchants(db: DbApi, options?: { onlyMissing?: boolean }): Promise<number>;
export function addMerchantRule(db: DbApi, rule: { pattern: string; merchant: string }): Promise<void>;
export function deleteMerchantRule(db: DbApi, ruleId: number): Promise<void>;
