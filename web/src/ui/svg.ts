export interface Scale { x: (L: number) => number; y: (bps: number) => number }

export function makeScale(width: number, height: number, pad: number, maxL: number, maxBps: number): Scale {
  const w = width - 2 * pad;
  const h = height - 2 * pad;
  return {
    x: (L) => pad + (L / maxL) * w,
    y: (bps) => pad + h - (bps / maxBps) * h,
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function linePath(points: { L: number; bps: number }[], s: Scale): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${r1(s.x(p.L))} ${r1(s.y(p.bps))}`).join(' ');
}

export function niceMaxBps(maxSeen: number): number {
  return Math.max(500, Math.ceil(maxSeen / 500) * 500);
}
