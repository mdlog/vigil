import { describe, expect, it } from 'vitest';
import { countdown, etClock, etDateTime, etOffsetLabel, REGIME_NAMES } from '../src/ui/time';

describe('time (America/New_York via Intl, no hand-rolled DST)', () => {
  it('formats a clock in ET', () => {
    // 2026-09-19T04:08:25Z = Sat Sep 19 00:08:25 EDT
    expect(etClock(Date.UTC(2026, 8, 19, 4, 8, 25))).toBe('Sat, Sep 19 · 00:08:25 ET');
  });
  it('formats a transition time in ET', () => {
    expect(etDateTime(1789997400)).toBe('Mon Sep 21, 09:30 ET'); // next open
    expect(etDateTime(1789761600)).toBe('Fri Sep 18, 16:00 ET'); // last close
  });
  it('knows the DST label across the November boundary', () => {
    expect(etOffsetLabel(Date.UTC(2026, 10, 1, 5, 0, 0))).toBe('EDT'); // Nov 1 01:00 EDT
    expect(etOffsetLabel(Date.UTC(2026, 10, 1, 7, 0, 0))).toBe('EST'); // Nov 1 02:00 EST
  });
  it('countdown never goes negative', () => {
    expect(countdown(100, 160)).toBe(60);
    expect(countdown(200, 160)).toBe(0);
  });
  it('names regimes in enum order', () => {
    expect(REGIME_NAMES).toEqual(['MARKET', 'EXTENDED', 'OVERNIGHT', 'CLOSED', 'CORP_ACTION']);
  });
});
