import { useRef, useState, type PointerEvent } from 'react';
import type { CurvePoint } from '../chain/curve';
import type { Snapshot } from '../chain/snapshot';
import { fmtBps } from '../ui/format';
import { CURVE_DIMS, curveGeometry, nearestPoint, type CurveDims } from '../view/curve';

/** H(L) as VigilRiskEngine computes it on-chain: the market cap, the floor, three reference closures and "now". */
export function HaircutCurve({ curve, snapshot, dims = CURVE_DIMS }: { curve: CurvePoint[]; snapshot: Snapshot | null; dims?: CurveDims }) {
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<CurvePoint | null>(null);
  const g = snapshot
    ? curveGeometry(curve, { capBps: snapshot.capBps, hFloorBps: snapshot.surface.hFloorBps, closureLen: snapshot.closureLen, engineHaircutBps: snapshot.engineHaircutBps }, dims)
    : null;
  if (!g || !snapshot) return <div className="curve-box"><p className="curve-empty">reading the curve from VigilRiskEngine…</p></div>;
  const { W, H, padL, padR, padT, padB } = g.dims;
  const onMove = (ev: PointerEvent<SVGSVGElement>) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    setHover(nearestPoint(curve, g, ((ev.clientX - r.left) / r.width) * W));
  };
  const hx = hover ? g.xOf(hover.L) : 0;
  const hy = hover ? g.yOf(hover.bps) : 0;
  return (
    <div className="curve-box">
      <svg ref={svg} className="dashboard-risk-curve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Haircut as a function of closure length, computed on-chain" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="dashCurve" x1="0" x2="1"><stop offset="0" stopColor="#85e8d1" /><stop offset="1" stopColor="#f3ba56" /></linearGradient>
          <linearGradient id="dashFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#f3ba56" stopOpacity=".22" /><stop offset="1" stopColor="#f3ba56" stopOpacity="0" /></linearGradient>
        </defs>
        <g className="dashboard-grid">
          {g.yTicks.map((t) => (
            <g key={t.label}>
              <line x1={padL} x2={W - padR} y1={t.y} y2={t.y} />
              <text x={padL - 8} y={t.y + 3} textAnchor="end">{t.label}</text>
            </g>
          ))}
          {g.xTicks.map((t) => <text key={t.label} x={t.x} y={H - padB + 18} textAnchor="middle">{t.label}</text>)}
        </g>
        {g.refs.map((r) => (
          <g key={r.kind} className={`curve-ref ${r.kind}`}>
            <line x1={padL} x2={W - padR} y1={r.y} y2={r.y} />
            <text x={W - padR} y={r.y - 5} textAnchor="end">{r.label}</text>
          </g>
        ))}
        <path className="dashboard-curve-fill" d={g.area} />
        <path className="dashboard-curve" d={g.line} />
        {g.markers.map((m) => (
          <g key={m.label} className="curve-marker">
            <line className="dashboard-marker" x1={m.x} x2={m.x} y1={m.yBase} y2={m.y} />
            <circle cx={m.x} cy={m.y} r={4} />
            <text x={m.x} y={m.y - 12} textAnchor="middle">{m.label}</text>
          </g>
        ))}
        <g className="curve-now">
          <circle className="halo" cx={g.now.x} cy={g.now.y} r={10} />
          <circle cx={g.now.x} cy={g.now.y} r={5} />
          <text x={g.now.anchorStart ? g.now.x + 12 : g.now.x - 12} y={g.now.y + 18} textAnchor={g.now.anchorStart ? 'start' : 'end'}>{g.now.label}</text>
        </g>
        {hover && (
          <g className="curve-hover">
            <line x1={hx} x2={hx} y1={padT} y2={H - padB} />
            <circle cx={hx} cy={hy} r={5} />
          </g>
        )}
      </svg>
      {hover && (
        <div className="curve-tooltip" role="tooltip" style={{ left: `${(hx / W) * 100}%`, top: `${(hy / H) * 100}%` }}>
          L = {(hover.L / 3600).toFixed(0)} h → H = {fmtBps(hover.bps)} · market applies {fmtBps(Math.min(hover.bps, snapshot.capBps))}
        </div>
      )}
    </div>
  );
}
