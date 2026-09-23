import { ArrowDownRight, ArrowUpRight, ShieldCheck } from 'lucide-react';
import { SYMBOL } from '../../deployment';
import type { Live } from '../../hooks/useSnapshot';
import { fmtBps } from '../../ui/format';
import { etClock } from '../../ui/time';
import { economyView, marketView, oracleView, sessionView } from '../../view/panels';
import { DEMO_SCRIPT, REPLAYS } from '../evidence';
import { HaircutCurve } from '../HaircutCurve';

/** "1d 21h 30m" → ["1d 21h", "30m"]: the Manus clock sets the last unit in amber. */
function splitLast(s: string): [string, string] {
  const i = s.lastIndexOf(' ');
  return i < 0 ? ['', s] : [s.slice(0, i), s.slice(i + 1)];
}

function Stat({ label, value, note, tone }: { label: string; value?: string; note?: string; tone?: 'amber' | 'mint' }) {
  return (
    <article className={tone ? `dashboard-stat ${tone}` : 'dashboard-stat'}>
      <div className="dashboard-stat-top"><span>{label}</span><ArrowUpRight size={15} /></div>
      <strong>{value ?? '—'}</strong>
      <small>{note ?? ''}</small>
    </article>
  );
}

export function Overview({ live, nowMs }: { live: Live; nowMs: number }) {
  const s = live.snapshot;
  const nowSec = Math.floor(nowMs / 1000);
  const v = s ? sessionView(s, nowMs) : null;
  const o = s ? oracleView(s) : null;
  const e = s ? economyView(s, nowSec) : null;
  const m = s ? marketView(s, nowSec, live.params?.lltv ?? null) : null;
  const [cdHead, cdTail] = splitLast(v?.countdown ?? '—');
  return (
    <>
      <section className="dashboard-hero-grid">
        <article className="session-panel" id="session">
          <div className="panel-label"><span>01 / EXCHANGE SESSION RIGHT NOW</span><b>ON-CHAIN DERIVED</b></div>
          <div className="session-status">
            <div>
              <span className={`regime-badge regime-${v?.regimeClass ?? 'none'}`}><i /> {v?.regime ?? 'CONNECTING'}</span>
              <h2>{v?.headline ?? 'Reading the chain…'}</h2>
              <p>{v?.note ?? 'The regime is derived on-chain from the NYSE calendar — DST, holidays and early closes included.'}</p>
            </div>
            <div className="session-time">
              <small>{(v?.nextLabel ?? 'Next transition').toUpperCase()}</small>
              <b>{cdHead} <em>{cdTail}</em></b>
              <span>{v?.nextAt ?? ''}</span>
            </div>
          </div>
          <div className="session-progress" role="progressbar" aria-label="Time to the next transition" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v?.progressPct ?? 0)}>
            <span style={{ width: `${(v?.progressPct ?? 0).toFixed(2)}%` }} />
          </div>
          <div className="session-footer">
            <span>Closure length <b>L = {v?.closureHours ?? '—'}</b></span>
            <span>Feed <b className={v ? (v.feedUsable ? 'mint-text' : 'amber-text') : undefined}>{v ? (v.feedUsable ? 'USABLE' : 'NOT USABLE') : '—'}</b></span>
            <span>{v?.feedNote ?? ''}</span>
          </div>
          <p className="session-clock">{etClock(nowMs)}</p>
        </article>

        <article className="oracle-panel" id="oracle">
          <div className="panel-label"><span>ORACLE STATUS</span><ShieldCheck size={16} /></div>
          <div className="oracle-value">
            <small>VIGIL ORACLE · USDG PER {SYMBOL}</small>
            <strong className={o?.reverting ? 'warn-text' : undefined}>{o?.price ?? '—'}</strong>
            <span>{o?.formula ?? ''}</span>
          </div>
          <div className="oracle-compare">
            <div><small>RAW FEED · {SYMBOL}/USD</small><b>{o?.feed ?? '—'}</b></div>
            <ArrowDownRight size={18} />
            <div><small>HAIRCUT IN FORCE</small><b className="amber-text">{o?.haircut ?? '—'}</b></div>
          </div>
          <p className="oracle-note">{o?.note ?? ''}</p>
        </article>
      </section>

      <section className="stats-grid" id="economy">
        <Stat label="Premium index" value={e?.premiumIndex} note={e?.premiumIndexNote} />
        <Stat label="Premium for this closure" value={e?.closurePremium} note={e?.closurePremiumNote} tone="amber" />
        <Stat label="Backstop · first-loss ERC-4626" value={e?.backstop} note={e?.backstopNote} tone="mint" />
      </section>

      <section className="dashboard-two-col">
        <article className="panel curve-panel" id="price">
          <div className="panel-heading">
            <div><span className="panel-eyebrow">02 / HAIRCUT SURFACE</span><h3>Haircut H(L) by closure length</h3></div>
            <span className="formula">H(L) · {live.curve.length || '—'} POINTS ON-CHAIN</span>
          </div>
          <HaircutCurve curve={live.curve} snapshot={s} />
          <div className="curve-legend">
            <span><i className="dot-mint" /> Engine H(L) now <b>{s ? fmtBps(s.engineHaircutBps) : '—'}</b></span>
            <span><i className="dot-amber" /> Market cap <b>{s ? fmtBps(s.capBps) : '—'}</b></span>
          </div>
        </article>

        <article className="panel market-panel" id="market">
          <div className="panel-heading">
            <div><span className="panel-eyebrow">03 / MORPHO MARKET</span><h3>{SYMBOL} / USDG</h3></div>
            <span className="lltv-badge">LLTV {m?.lltv ?? '—'}</span>
          </div>
          <div className="market-numbers">
            <div><small>SUPPLIED</small><b>{m?.supplied ?? '—'}</b><span>USDG</span></div>
            <div><small>BORROWED</small><b>{m?.borrowed ?? '—'}</b><span>USDG</span></div>
          </div>
          <div className="util-bar"><span style={{ width: `${Math.min(100, m?.utilPct ?? 0)}%` }} /></div>
          <div className="market-footer"><span>UTILISATION <b>{m?.util ?? '—'}</b></span><span>LAST UPDATE <b>{m?.lastUpdate ?? '—'}</b></span></div>
        </article>
      </section>

      <section className="evidence-panel panel" id="evidence">
        <div className="panel-heading">
          <div><span className="panel-eyebrow">04 / HISTORICAL EVIDENCE</span><h3>Vigil turns closure gaps into covered events.</h3></div>
          <a href={DEMO_SCRIPT} target="_blank" rel="noreferrer">Replay script <ArrowUpRight size={14} /></a>
        </div>
        <div className="evidence-table">
          <div className="evidence-table-head"><span>REPLAY</span><span>CONTROL MARKET</span><span>VIGIL MARKET</span><span>WHAT VIGIL DID</span></div>
          {REPLAYS.map((r) => (
            <div key={r.replay}>
              <b>{r.replay}</b>
              {r.control ? <span className="loss">{r.control} <small>{r.controlNote}</small></span> : <span className="muted-text">—</span>}
              <span className="zero">0 <small>bad debt</small></span>
              <span>{r.what}</span>
            </div>
          ))}
        </div>
        <p className="panel-note">Two identical Morpho Blue markets replayed on Anvil with the production contracts and the real dates. In four years of NVDA data, both gaps that would have created bad debt in an 86 % LLTV market came at a Monday open.</p>
      </section>
    </>
  );
}
