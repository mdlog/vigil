import type { Live } from '../../hooks/useSnapshot';
import { CURVE_DIMS_LARGE } from '../../view/curve';
import { riskParams } from '../../view/panels';
import { HaircutCurve } from '../HaircutCurve';

export function MarketRisk({ live, nowMs }: { live: Live; nowMs: number }) {
  const params = riskParams(live.snapshot, Math.floor(nowMs / 1000));
  return (
    <section className="panel detail-panel" id="risk">
      <div className="panel-heading">
        <div><span className="panel-eyebrow">LIVE PARAMETERS</span><h3>Risk surface configuration</h3></div>
        <span className="lltv-badge">READ ON-CHAIN</span>
      </div>
      <div className="parameter-grid">
        {params.map((p) => <div key={p.label}><small>{p.label}</small><b>{p.value}</b><span>{p.note}</span></div>)}
      </div>
      <div className="large-curve"><HaircutCurve curve={live.curve} snapshot={live.snapshot} dims={CURVE_DIMS_LARGE} /></div>
      <p className="panel-note">H(L) = clamp(H_floor + k·σ·√(L / τ_night)) for a closure of length L, evaluated point by point by VigilRiskEngine.closureHaircutBps. The market oracle applies min(H, cap); keepers can only tighten.</p>
    </section>
  );
}
