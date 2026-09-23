import { formatUnits } from 'viem';
import { fmtUsd } from '../ui/format';

/** USDG (6 decimals) for labels and tiles. */
export const usd = (v: bigint, d = 2) => fmtUsd(Number(formatUnits(v, 6)), d);
/** The stock token (18 decimals), up to `d` fraction digits. */
export const stk = (v: bigint, d = 4) => Number(formatUnits(v, 18)).toLocaleString('en-US', { maximumFractionDigits: d });
/** Morpho LLTV (WAD) → basis points. */
export const lltvBpsOf = (lltv: bigint) => Number(lltv / 10n ** 14n);
/** The Vigil market's LLTV, used until the market params have been read. */
export const DEFAULT_LLTV = 860_000_000_000_000_000n;

/**
 * What a person typed, as a plain decimal for parseAmount: spaces and _ dropped, "1,000.5" and "1.000,5" → "1000.5",
 * "0,5" → "0.5" (a decimal-comma keyboard). A comma is a thousands separator only inside three-digit groups that do
 * not start with 0; any other comma is the decimal point, and a number still ambiguous after that is null (refused).
 */
export function normalizeDecimal(input: string): string | null {
  const s = input.replace(/[\s_]/g, '');
  if (/^[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(s)) return s.replace(/,/g, '');
  if (/^[1-9]\d{0,2}(\.\d{3})+,\d+$/.test(s)) return s.replace(/\./g, '').replace(',', '.');
  if (/^\d*,\d+$/.test(s)) return s.replace(',', '.');
  return s.includes(',') ? null : s;
}
