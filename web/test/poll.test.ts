import { describe, expect, it } from 'vitest';
import { isStale, nextDelayMs, pollBaseMs } from '../src/ui/poll';

describe('polling schedule', () => {
  it('backs off 15 → 30 → 60 s and caps', () => {
    expect(nextDelayMs(0)).toBe(15000);
    expect(nextDelayMs(1)).toBe(30000);
    expect(nextDelayMs(2)).toBe(60000);
    expect(nextDelayMs(9)).toBe(60000);
  });
  it('honours ?poll= with a 2 s floor', () => {
    expect(pollBaseMs('?poll=4000')).toBe(4000);
    expect(pollBaseMs('?poll=500')).toBe(15000);
    expect(pollBaseMs('')).toBe(15000);
    expect(nextDelayMs(0, 4000)).toBe(4000);
  });
  it('is stale after 60 s without success', () => {
    expect(isStale(0, 59_000)).toBe(false);
    expect(isStale(0, 61_000)).toBe(true);
  });
});

import { rpcOverride } from '../src/chain/client';
describe('rpc override', () => {
  it('accepts loopback only', () => {
    expect(rpcOverride('?rpc=http://127.0.0.1:8546')).toBe('http://127.0.0.1:8546/');
    expect(rpcOverride('?rpc=http://localhost:8546')).toBe('http://localhost:8546/');
    expect(rpcOverride('?rpc=https://evil.example')).toBeNull();
    expect(rpcOverride('')).toBeNull();
  });
});
