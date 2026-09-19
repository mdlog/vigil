import { describe, expect, it } from 'vitest';
import { CURVE_L, MARKERS, curveCalls, decodeCurve } from '../src/chain/curve';

describe('curve grid', () => {
  it('spans 0…120 h in 2 h steps plus the three exact marker closures (64 points, sorted)', () => {
    expect(CURVE_L).toHaveLength(64);
    expect(CURVE_L[0]).toBe(0);
    expect(CURVE_L[1]).toBe(7200);
    expect(CURVE_L[63]).toBe(432000);
    expect(CURVE_L).toContain(235800);
    expect([...CURVE_L].sort((a, b) => a - b)).toEqual(CURVE_L);
  });
  it('builds one closureHaircutBps call per point with the surface tuple', () => {
    const calls = curveCalls({ sigmaGapWad: 16000000000000000n, kTailBps: 30000, hFloorBps: 50, hMaxBps: 2500, updatedAt: 0 });
    expect(calls).toHaveLength(64);
    expect(calls[5]!.functionName).toBe('closureHaircutBps');
    expect(calls[5]!.args[1]).toBe(36000n);
    expect(calls[5]!.args[2]).toBe(10000n);
  });
  it('decodes results into {L, bps}', () => {
    const results = CURVE_L.map((L) => ({ status: 'success' as const, result: BigInt(50 + Math.floor(L / 1000)) }));
    const pts = decodeCurve(results);
    expect(pts[0]).toEqual({ L: 0, bps: 50 });
    expect(pts[63]).toEqual({ L: 432000, bps: 482 });
  });
  it('marks overnight / weekend / long weekend', () => {
    expect(MARKERS.map((m) => m.L)).toEqual([63000, 235800, 322200]);
  });
});
