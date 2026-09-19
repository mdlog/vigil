import { describe, expect, it } from 'vitest';
import { isStale, nextDelayMs } from '../src/ui/poll';

describe('polling schedule', () => {
  it('backs off 15 → 30 → 60 s and caps', () => {
    expect(nextDelayMs(0)).toBe(15000);
    expect(nextDelayMs(1)).toBe(30000);
    expect(nextDelayMs(2)).toBe(60000);
    expect(nextDelayMs(9)).toBe(60000);
  });
  it('is stale after 60 s without success', () => {
    expect(isStale(0, 59_000)).toBe(false);
    expect(isStale(0, 61_000)).toBe(true);
  });
});
