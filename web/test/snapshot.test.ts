import { describe, expect, it } from 'vitest';
import { decodeCore, coreCalls, type MulticallResult } from '../src/chain/snapshot';

const ok = <T>(result: T): MulticallResult => ({ status: 'success', result } as MulticallResult);
const fail = (msg: string): MulticallResult => ({ status: 'failure', error: new Error(msg) } as MulticallResult);

// Order must match coreCalls(): see CORE_ORDER in src/chain/snapshot.ts
const fixture: MulticallResult[] = [
  ok(1789790905n),                                    // multicall3.getCurrentBlockTimestamp
  ok([3, 3, 1789761600n, 1789997400n]),               // regimeOf → (effective, cal, closeAt, nextOpen)
  ok([1789761600n, 1789997400n, true, 1789738200n, 1789761600n, 0n]), // closureOf
  ok(true),                                           // feedIsUsable
  ok(108040000000n),                                  // premiumIndex
  ok(1789790836n),                                    // lastPokeOf
  ok(['0xaF0F38314f76A1Dd15576bbD60DC12fF95dF209b', 21600n, 3, 3600n, 3600n, 100, true]), // configs
  ok(977),                                            // haircutBps
  ok(977),                                            // targetHaircutBps
  ok([16000000000000000n, 30000, 50, 2500, 1789790836n]), // surfaces
  ok(false),                                          // eventActive
  ok(114000000000000000000000000n),                   // price
  ok(120000000000000000000000000n),                   // unhaircutPrice
  ok(500),                                            // currentHaircutBps
  ok(500),                                            // MARKET_HAIRCUT_CAP_BPS
  ok(0n),                                             // totalAssets
  ok(0n),                                             // totalSupply
  ok(100000000000n),                                  // coverageCapOf
  ok(0n),                                             // totalCovered
  ok(604800n),                                        // COOLDOWN
  ok([0n, 0n, 0n, 0n, 1789790839n, 0n]),              // market
  ok([1n, 12000000000n, 1789790828n, 1789790828n, 1n]), // latestRoundData
];

describe('decodeCore', () => {
  it('decodes a Saturday CLOSED snapshot', () => {
    expect(coreCalls()).toHaveLength(fixture.length);
    const s = decodeCore(fixture, 1_000);
    expect(s.regime).toBe(3);
    expect(s.calRegime).toBe(3);
    expect(s.closeAt).toBe(1789761600);
    expect(s.nextOpen).toBe(1789997400);
    expect(s.closureLen).toBe(235800);
    expect(s.inClosure).toBe(true);
    expect(s.feedUsable).toBe(true);
    expect(s.feedAnswer).toBe(12000000000n);
    expect(s.marketStaleSeconds).toBe(21600);
    expect(s.price).toBe(114000000000000000000000000n);
    expect(s.priceError).toBeNull();
    expect(s.haircutNowBps).toBe(500);
    expect(s.engineHaircutBps).toBe(977);
    expect(s.capBps).toBe(500);
    expect(s.surface).toEqual({ sigmaGapWad: 16000000000000000n, kTailBps: 30000, hFloorBps: 50, hMaxBps: 2500, updatedAt: 1789790836 });
    expect(s.premiumIndex).toBe(108040000000n);
    expect(s.coverageCap).toBe(100000000000n);
    expect(s.cooldown).toBe(604800);
    expect(s.chainTime).toBe(1789790905);
    expect(s.fetchedAtMs).toBe(1_000);
  });
  it('keeps a reverting price() as an error, not a crash', () => {
    const f = fixture.slice();
    f[11] = fail('OracleRevert: CORP_ACTION');
    const s = decodeCore(f, 0);
    expect(s.price).toBeNull();
    expect(s.priceError).toContain('CORP_ACTION');
  });
  it('throws when a non-optional call failed', () => {
    const f = fixture.slice();
    f[1] = fail('boom');
    expect(() => decodeCore(f, 0)).toThrow(/regimeOf/);
  });
});
