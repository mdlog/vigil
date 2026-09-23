import { describe, expect, it } from 'vitest';
import { CURVE_DIMS, curveGeometry, nearestPoint } from '../src/view/curve';

const CURVE = [
  { L: 0, bps: 100 }, { L: 63000, bps: 300 }, { L: 216000, bps: 400 }, { L: 235800, bps: 1070 }, { L: 322200, bps: 1200 }, { L: 432000, bps: 900 },
];
const S = { capBps: 500, hFloorBps: 100, closureLen: 235800, engineHaircutBps: 1070 };

describe('curveGeometry', () => {
  it('has no geometry before the curve is read', () => {
    expect(curveGeometry([], S)).toBeNull();
  });
  it('scales to a 5 % grid above the largest of curve and cap', () => {
    const g = curveGeometry(CURVE, S)!;
    expect(g.maxL).toBe(432000);
    expect(g.maxBps).toBe(1500);
    expect(g.yTicks.map((t) => t.label)).toEqual(['0%', '5%', '10%', '15%']);
    expect(g.xTicks.map((t) => t.label)).toEqual(['0', '24h', '48h', '72h', '96h', '120h']);
    expect(g.line.startsWith(`M${CURVE_DIMS.padL} `)).toBe(true);
    expect(g.area.endsWith('Z')).toBe(true);
  });
  it('labels the cap, the floor, the three closures and the current point with on-chain values', () => {
    const g = curveGeometry(CURVE, S)!;
    expect(g.refs.map((r) => r.label)).toEqual(['market cap 5.00 %', 'floor 1.00 %']);
    expect(g.markers.map((m) => m.label)).toEqual(['overnight 17.5h · 3.00 %', 'weekend 65.5h · 10.70 %', 'long weekend 89.5h · 12.00 %']);
    expect(g.now.label).toBe('now · L 65.5h → 10.70 %');
    expect(g.now.anchorStart).toBe(true);
  });
  it('finds the on-chain point nearest to the pointer, none outside the plot', () => {
    const g = curveGeometry(CURVE, S)!;
    expect(nearestPoint(CURVE, g, g.xOf(210000))).toEqual({ L: 216000, bps: 400 });
    expect(nearestPoint(CURVE, g, 1)).toBeNull();
  });
});
