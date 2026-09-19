import { describe, expect, it } from 'vitest';
import {
  fmtAge, fmtBps, fmtDuration, fmtUsd, feedToUsd, premiumPer1000, priceToUsdg, shortAddr, usdg6,
} from '../src/ui/format';

describe('format', () => {
  it('bps to percent', () => {
    expect(fmtBps(500)).toBe('5.00 %');
    expect(fmtBps(977)).toBe('9.77 %');
    expect(fmtBps(0)).toBe('0.00 %');
  });
  it('morpho price (36-dec, 6/18 tokens) to USDG', () => {
    expect(priceToUsdg(114000000000000000000000000n)).toBeCloseTo(114, 6);
    expect(priceToUsdg(120000000000000000000000000n)).toBeCloseTo(120, 6);
  });
  it('feed 8 decimals and USDG 6 decimals', () => {
    expect(feedToUsd(12000000000n)).toBe(120);
    expect(usdg6(100000000000n)).toBe(100000);
  });
  it('premium per 1000 USDG debt from a delta index', () => {
    // 1.48e9 WAD/s × 235 800 s = 3.49e14 → 0.349 USDG per 1 000 USDG
    expect(premiumPer1000(1480000000n * 235800n)).toBeCloseTo(0.34898, 4);
  });
  it('durations and ages', () => {
    expect(fmtDuration(0)).toBe('0s');
    expect(fmtDuration(67)).toBe('1m 07s');
    expect(fmtDuration(3600 * 5 + 60 * 21 + 7)).toBe('5h 21m 07s');
    expect(fmtDuration(86400 * 2 + 3600 * 5 + 60 * 21)).toBe('2d 5h 21m');
    expect(fmtAge(12)).toBe('12 s ago');
    expect(fmtAge(4.7 * 3600)).toBe('4.7 h ago');
    expect(fmtAge(3 * 86400)).toBe('3.0 d ago');
  });
  it('money and addresses', () => {
    expect(fmtUsd(114)).toBe('114.00');
    expect(fmtUsd(1234567.891, 0)).toBe('1,234,568');
    expect(shortAddr('0x351Ca8799D409F3BF37b147928fEE756ee96cA72')).toBe('0x351C…cA72');
  });
});
