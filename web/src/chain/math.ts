/** Pure math behind the transaction panel: Morpho's share and health arithmetic (bit-exact with SharesMathLib and
 *  Morpho._isHealthy) and amount parsing. No I/O. */

const VIRTUAL_SHARES = 1_000_000n;
const VIRTUAL_ASSETS = 1n;
const WAD = 10n ** 18n;
export const ORACLE_PRICE_SCALE = 10n ** 36n;

const mulDivDown = (x: bigint, y: bigint, d: bigint) => (x * y) / d;
const mulDivUp = (x: bigint, y: bigint, d: bigint) => (x * y + (d - 1n)) / d;

/** SharesMathLib.toAssetsUp — what a borrower owes for `borrowShares`. */
export const debtOf = (borrowShares: bigint, totalBorrowAssets: bigint, totalBorrowShares: bigint) =>
  mulDivUp(borrowShares, totalBorrowAssets + VIRTUAL_ASSETS, totalBorrowShares + VIRTUAL_SHARES);

/** SharesMathLib.toAssetsDown — what a supplier can withdraw for `supplyShares`. */
export const suppliedOf = (supplyShares: bigint, totalSupplyAssets: bigint, totalSupplyShares: bigint) =>
  mulDivDown(supplyShares, totalSupplyAssets + VIRTUAL_ASSETS, totalSupplyShares + VIRTUAL_SHARES);

/** SharesMathLib.toSharesDown — shares minted for `assets`. */
export const toSharesDown = (assets: bigint, totalAssets: bigint, totalShares: bigint) =>
  mulDivDown(assets, totalShares + VIRTUAL_SHARES, totalAssets + VIRTUAL_ASSETS);

/** Morpho._isHealthy: collateral × price / 1e36 (down) × lltv / 1e18 (down). */
export const maxBorrowOf = (collateral: bigint, price: bigint, lltv: bigint) =>
  mulDivDown(mulDivDown(collateral, price, ORACLE_PRICE_SCALE), lltv, WAD);

export const collateralValue = (collateral: bigint, price: bigint) => mulDivDown(collateral, price, ORACLE_PRICE_SCALE);

/** debt / collateral value in basis points; 0 when the collateral is worth nothing. */
export const ltvBps = (collateral: bigint, price: bigint, debt: bigint): number => {
  const value = collateralValue(collateral, price);
  return value === 0n ? 0 : Number((debt * 10_000n) / value);
};

/** "1,000.5" → 1000500000n at 6 decimals; null for empty, zero, negative, malformed or over-precise input. */
export function parseAmount(input: string, decimals: number): bigint | null {
  const s = input.replace(/[,\s_]/g, '');
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const whole = m[1] ?? '0';
  const frac = m[2] ?? '';
  if (frac.length > decimals) return null;
  const v = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0');
  return v > 0n ? v : null;
}
