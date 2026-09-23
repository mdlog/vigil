import { describe, expect, it } from 'vitest';
import { heroView, syncStatus } from '../src/view/status';
import { T0, snap } from './fixtures';

const NOW = T0 * 1000;

describe('syncStatus', () => {
  it('connecting before the first read, offline when the first read failed', () => {
    expect(syncStatus(false, null, null, NOW)).toBe('connecting');
    expect(syncStatus(false, null, 'fetch failed', NOW)).toBe('offline');
  });
  it('live within 60 s of the last good read, stale after', () => {
    expect(syncStatus(true, NOW - 1_000, null, NOW)).toBe('live');
    expect(syncStatus(true, NOW - 61_000, 'fetch failed', NOW)).toBe('stale');
  });
});

describe('heroView (landing card)', () => {
  it('shows the live TSLA price, haircut and regime', () => {
    expect(heroView(snap(), 'live', 'TSLA')).toEqual({
      symbol: 'TSLA', pair: 'TSLA / USDG', live: true, pill: 'LIVE TESTNET', price: '346.06', haircut: '−5.00 %', regime: 'CLOSED', footer: 'TESTNET LIVE · FEED USABLE',
    });
  });
  it('says when the feed is not usable', () => {
    expect(heroView(snap({ feedUsable: false }), 'live', 'TSLA').footer).toBe('TESTNET LIVE · FEED NOT USABLE');
  });
  it('never shows a number it does not have', () => {
    const off = heroView(null, 'offline', 'TSLA');
    expect([off.live, off.pill, off.price, off.footer]).toEqual([false, 'TESTNET OFFLINE', '—', 'RPC UNREACHABLE']);
    const stale = heroView(snap(), 'stale', 'TSLA');
    expect([stale.pill, stale.price]).toEqual(['TESTNET OFFLINE', '—']);
    const wait = heroView(null, 'connecting', 'TSLA');
    expect([wait.pill, wait.price, wait.footer]).toEqual(['CONNECTING', '—', 'CONNECTING TO TESTNET']);
  });
  it('an oracle that reverts is paused, not priced', () => {
    const v = heroView(snap({ price: null, priceError: 'FeedStale()' }), 'live', 'TSLA');
    expect([v.live, v.pill, v.price, v.regime, v.footer]).toEqual([false, 'ORACLE PAUSED', '—', 'CLOSED', 'TESTNET LIVE · ORACLE PAUSED']);
  });
});
