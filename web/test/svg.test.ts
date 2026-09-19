import { describe, expect, it } from 'vitest';
import { linePath, makeScale, niceMaxBps } from '../src/ui/svg';

describe('svg helpers', () => {
  it('scales L and bps into the plot box', () => {
    const s = makeScale(400, 200, 20, 432000, 1500);
    expect(s.x(0)).toBe(20);
    expect(s.x(432000)).toBe(380);
    expect(s.y(0)).toBe(180);
    expect(s.y(1500)).toBe(20);
  });
  it('builds a path', () => {
    const s = makeScale(400, 200, 20, 432000, 1500);
    expect(linePath([{ L: 0, bps: 0 }, { L: 432000, bps: 1500 }], s)).toBe('M20 180 L380 20');
  });
  it('rounds the y max to 500-bps steps', () => {
    expect(niceMaxBps(1304)).toBe(1500);
    expect(niceMaxBps(2500)).toBe(2500);
    expect(niceMaxBps(0)).toBe(500);
  });
});
