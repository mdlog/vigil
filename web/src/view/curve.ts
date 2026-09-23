/** Geometry of the H(L) chart (ported from web/src/panels/price.ts @ 7f9d414): scales, ticks, reference lines, the
 *  overnight / weekend / long-weekend markers and the current closure — everything but the drawing. */
import { MARKERS, type CurvePoint } from '../chain/curve';
import { fmtBps } from '../ui/format';
import { linePath, niceMaxBps } from '../ui/svg';

export interface CurveDims { W: number; H: number; padL: number; padR: number; padT: number; padB: number }
export const CURVE_DIMS: CurveDims = { W: 680, H: 280, padL: 44, padR: 16, padT: 28, padB: 34 };
export const CURVE_DIMS_LARGE: CurveDims = { W: 1000, H: 320, padL: 48, padR: 18, padT: 30, padB: 36 };

export interface CurveInput { capBps: number; hFloorBps: number; closureLen: number; engineHaircutBps: number }

export interface CurveGeometry {
  dims: CurveDims; maxL: number; maxBps: number;
  line: string; area: string;
  yTicks: { y: number; label: string }[];
  xTicks: { x: number; label: string }[];
  refs: { y: number; label: string; kind: 'cap' | 'floor' }[];
  markers: { x: number; y: number; yBase: number; label: string }[];
  now: { x: number; y: number; label: string; anchorStart: boolean };
  xOf: (L: number) => number;
  yOf: (bps: number) => number;
  lOf: (x: number) => number;
}

const nearest = (curve: CurvePoint[], L: number) => curve.reduce((a, b) => (Math.abs(b.L - L) < Math.abs(a.L - L) ? b : a));

export function curveGeometry(curve: CurvePoint[], s: CurveInput, d: CurveDims = CURVE_DIMS): CurveGeometry | null {
  const last = curve[curve.length - 1];
  if (!last) return null;
  const maxL = last.L;
  const maxBps = niceMaxBps(Math.max(...curve.map((p) => p.bps), s.capBps));
  const plotW = d.W - d.padL - d.padR;
  const plotH = d.H - d.padT - d.padB;
  const xOf = (L: number) => d.padL + (L / maxL) * plotW;
  const yOf = (bps: number) => d.padT + plotH - (bps / maxBps) * plotH;
  const lOf = (x: number) => ((x - d.padL) / plotW) * maxL;
  const line = linePath(curve, { x: xOf, y: yOf });
  const yTicks: CurveGeometry['yTicks'] = [];
  for (let bps = 0; bps <= maxBps; bps += 500) yTicks.push({ y: yOf(bps), label: `${bps / 100}%` });
  const xTicks: CurveGeometry['xTicks'] = [];
  for (let h = 0; h <= maxL / 3600; h += 24) xTicks.push({ x: xOf(h * 3600), label: h === 0 ? '0' : `${h}h` });
  const L = Math.min(s.closureLen, maxL);
  const nowX = xOf(L);
  return {
    dims: d, maxL, maxBps, line,
    area: `${line} L${xOf(maxL)} ${yOf(0)} L${xOf(0)} ${yOf(0)} Z`,
    yTicks, xTicks,
    refs: [
      { y: yOf(s.capBps), label: `market cap ${fmtBps(s.capBps)}`, kind: 'cap' },
      { y: yOf(s.hFloorBps), label: `floor ${fmtBps(s.hFloorBps)}`, kind: 'floor' },
    ],
    markers: MARKERS.map((m) => {
      const pt = curve.find((q) => q.L === m.L) ?? nearest(curve, m.L);
      return { x: xOf(m.L), y: yOf(pt.bps), yBase: yOf(0), label: `${m.label} ${(m.L / 3600).toFixed(1)}h · ${fmtBps(pt.bps)}` };
    }),
    now: { x: nowX, y: yOf(Math.min(s.engineHaircutBps, maxBps)), label: `now · L ${(L / 3600).toFixed(1)}h → ${fmtBps(s.engineHaircutBps)}`, anchorStart: nowX < d.W * 0.6 },
    xOf, yOf, lOf,
  };
}

/** The on-chain point nearest to an x position in SVG units, or null outside the plot. */
export function nearestPoint(curve: CurvePoint[], g: CurveGeometry, x: number): CurvePoint | null {
  const L = g.lOf(x);
  if (L < 0 || L > g.maxL || curve.length === 0) return null;
  return nearest(curve, L);
}
