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
