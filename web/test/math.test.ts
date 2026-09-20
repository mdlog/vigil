import { describe, expect, it } from 'vitest';
import { debtOf, ltvBps, maxBorrowOf, parseAmount, suppliedOf, toSharesDown } from '../src/chain/math';

describe('Morpho share math (bit-exact with SharesMathLib)', () => {
  const shares = 100_000_000n * 1_000_000n; // 100 USDG borrowed in one go
  it('debtOf rounds up like toAssetsUp', () => {
    expect(debtOf(0n, 0n, 0n)).toBe(0n);
    expect(debtOf(1n, 0n, 0n)).toBe(1n);
    expect(debtOf(shares, 100_000_000n, shares)).toBe(100_000_000n);
    expect(debtOf(shares, 110_000_000n, shares)).toBe(110_000_000n);
  });
  it('suppliedOf rounds down like toAssetsDown', () => {
    expect(suppliedOf(0n, 0n, 0n)).toBe(0n);
    expect(suppliedOf(1n, 0n, 0n)).toBe(0n);
    expect(suppliedOf(shares, 120_000_000n, shares)).toBe(119_999_999n); // the virtual offsets cost 1 wei on the way down
  });
  it('toSharesDown is the inverse Morpho applies on supply', () => {
    expect(toSharesDown(100_000_000n, 0n, 0n)).toBe(shares);
  });
});

describe('health preview', () => {
  const price = 346_056_500_000_000_000_000_000_000n; // 346.0565 USDG per TSLA at the 1e24 oracle scale
  const lltv = 860_000_000_000_000_000n;
  const coll = 150_000_000_000_000_000n; // 0.15 TSLA
  it('maxBorrowOf matches Morpho._isHealthy rounding', () => {
    expect(maxBorrowOf(coll, price, lltv)).toBe(44_641_288n); // 0.15 × 346.0565 × 0.86
  });
  it('ltvBps is debt over collateral value', () => {
    expect(ltvBps(coll, price, 44_590_000n)).toBe(8590);
    expect(ltvBps(0n, price, 1n)).toBe(0);
  });
});

describe('parseAmount', () => {
  it('parses decimals to the token scale', () => {
    expect(parseAmount('120', 6)).toBe(120_000_000n);
    expect(parseAmount('0.15', 18)).toBe(150_000_000_000_000_000n);
    expect(parseAmount('1,000.5', 6)).toBe(1_000_500_000n);
  });
  it('rejects empty, zero, negative and over-precise input', () => {
    expect(parseAmount('', 6)).toBeNull();
    expect(parseAmount('0', 6)).toBeNull();
    expect(parseAmount('-1', 6)).toBeNull();
    expect(parseAmount('1.1234567', 6)).toBeNull();
    expect(parseAmount('abc', 6)).toBeNull();
  });
});
