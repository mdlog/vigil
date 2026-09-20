/** Pure helpers of the keeper: Morpho's share and health math (bit-exact with SharesMathLib / Morpho._isHealthy) and
 *  the small time grammar of `attest`. No I/O, so `npm test` covers them without a chain. */

export const REGIME = ["MARKET", "EXTENDED", "OVERNIGHT", "CLOSED", "CORP_ACTION"] as const;

const VIRTUAL_SHARES = 1_000_000n;
const VIRTUAL_ASSETS = 1n;
const WAD = 10n ** 18n;
export const ORACLE_PRICE_SCALE = 10n ** 36n;

const mulDivUp = (x: bigint, y: bigint, d: bigint) => (x * y + (d - 1n)) / d;
const mulDivDown = (x: bigint, y: bigint, d: bigint) => (x * y) / d;

/** SharesMathLib.toAssetsUp: the debt Morpho charges for `borrowShares`. */
export const debtOf = (borrowShares: bigint, totalBorrowAssets: bigint, totalBorrowShares: bigint) =>
  mulDivUp(borrowShares, totalBorrowAssets + VIRTUAL_ASSETS, totalBorrowShares + VIRTUAL_SHARES);

/** Morpho._isHealthy: maxBorrow = collateral * price / 1e36 (down) * lltv / 1e18 (down) >= debt. */
export const maxBorrowOf = (collateral: bigint, price: bigint, lltv: bigint) =>
  mulDivDown(mulDivDown(collateral, price, ORACLE_PRICE_SCALE), lltv, WAD);
export const isHealthy = (collateral: bigint, price: bigint, lltv: bigint, debt: bigint) =>
  maxBorrowOf(collateral, price, lltv) >= debt;

/** debt / collateral value in basis points, for display (0 when the collateral is worth nothing). */
export const ltvBps = (collateral: bigint, price: bigint, debt: bigint) => {
  const value = mulDivDown(collateral, price, ORACLE_PRICE_SCALE);
  return value === 0n ? 0 : Number((debt * 10_000n) / value);
};

/** `now` | `+Nh` | `+Nm` | unix seconds | undefined → base. */
export const parseWhen = (v: string | undefined, base: number, now: number): number => {
  if (!v) return base;
  if (v === "now") return now;
  const m = /^\+(\d+)([hm])$/.exec(v);
  if (m) return base + Number(m[1]) * (m[2] === "h" ? 3600 : 60);
  if (/^\d+$/.test(v)) return Number(v);
  throw new Error(`cannot parse time "${v}" (use now, +2h, +30m or unix seconds)`);
};

/** viem wraps reverts in a long report; the first line and the revert reason are what an operator needs. */
export const shortError = (e: unknown): string => {
  const x = e as { shortMessage?: string; metaMessages?: string[]; message?: string };
  const reason = x.metaMessages?.find((m) => /Error:|reason/.test(m));
  return [x.shortMessage ?? x.message ?? String(e), reason].filter(Boolean).join(" — ");
};
