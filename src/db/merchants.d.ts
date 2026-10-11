import type { MerchantRule } from '../types';

export function cleanMerchantName(description: unknown): string;
export function resolveMerchant(
  description: unknown,
  merchantRules?: ReadonlyArray<Pick<MerchantRule, 'pattern' | 'merchant'>>,
): string;
