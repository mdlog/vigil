import { ArrowUpRight, ExternalLink } from 'lucide-react';
import { ADDR, MARKETS, CONTRACT_ORDER, MARKET_ID, TX_OF, explorerAddress, explorerTx } from '../../deployment';
import { shortAddr } from '../../ui/format';
import { ISSUER, ROLE } from '../contractsInfo';

/** How Vigil attaches to a Morpho market (moved from web/src/panels/contracts.ts @ 7f9d414). */
function Flow() {
  const B = 36;
  const box = (x: number, y: number, w: number, h: number, label: string, ext = false) => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} className={ext ? 'flow-box flow-ext' : 'flow-box'} />
      <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" className={ext ? 'flow-text on-dark' : 'flow-text'}>{label}</text>
    </g>
  );
  const arrow = (x1: number, y: number, x2: number, label?: string) => (
    <g>
      <line x1={x1} y1={y} x2={x2} y2={y} className="flow-arrow" markerEnd="url(#arrowhead)" />
      {label && <text x={(x1 + x2) / 2} y={y - 8} textAnchor="middle" className="flow-label">{label}</text>}
    </g>
  );
  return (
    <svg viewBox="0 0 900 300" className="flow" role="img" aria-label="How Vigil attaches to a Morpho market">
      <defs>
        <marker id="arrowhead" markerWidth={8} markerHeight={8} refX={7} refY={4} orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L8 4 L0 8 z" className="flow-head" /></marker>
      </defs>
      {box(0, 12, 120, B, 'Calendar')}{arrow(120, 30, 158)}
      {box(160, 12, 160, B, 'SessionOracle')}{arrow(320, 30, 358)}
      {box(360, 12, 140, B, 'RiskEngine')}{arrow(500, 30, 538)}
      {box(540, 12, 120, B, 'Oracle')}{arrow(660, 30, 718, 'price()')}
      {box(720, 12, 180, 268, 'Morpho market', true)}
      {box(0, 128, 120, B, 'Premium')}{arrow(120, 146, 158)}
      {box(160, 128, 160, B, 'Backstop')}{arrow(320, 146, 358)}
      {box(360, 128, 180, B, 'LossReporter')}{arrow(540, 146, 718, 'liquidateWithCover')}
      {box(360, 244, 180, B, 'PreLiquidation')}{arrow(540, 262, 718, 'soft unwind (members)')}
    </svg>
  );
}

export function Contracts() {
  return (
    <section className="panel contracts-panel" id="registry">
      <div className="panel-heading">
        <div><span className="panel-eyebrow">05 / DEPLOYMENT REGISTRY</span><h3>The contracts in the deployment manifest</h3></div>
        <a href={explorerAddress(ADDR.VigilOracle)} target="_blank" rel="noreferrer">Open explorer <ExternalLink size={14} /></a>
      </div>
      <div className="flow-wrap"><Flow /></div>
      <div className="contract-list">
        {CONTRACT_ORDER.map((name) => {
          const tx = TX_OF[name];
          return (
            <div className="contract-row" key={name}>
              <div><b>{name}</b>{ISSUER[name] && <span className="issuer">{ISSUER[name]}</span>}</div>
              <span className="role">{ROLE[name]}</span>
              <a href={explorerAddress(ADDR[name])} target="_blank" rel="noreferrer" title={ADDR[name]}><code>{shortAddr(ADDR[name])}</code><ArrowUpRight size={12} /></a>
              {tx ? <a href={explorerTx(tx)} target="_blank" rel="noreferrer">deploy tx ↗</a> : <span className="muted-text">external</span>}
            </div>
          );
        })}
      </div>
      {MARKETS.length < 2 && <p className="market-id">Morpho market id {MARKET_ID}</p>}
      {MARKETS.length > 1 && (
        <div className="markets-table">
          <div className="panel-heading"><div><span className="panel-eyebrow">06 / MARKETS</span><h3>One Morpho market per stock token</h3></div></div>
          <p className="muted">The contracts above are shared; each market adds its own feed and VigilOracle, registered in them. The stock token and feed listed above are {MARKETS[0]!.symbol}&apos;s.</p>
          <div className="markets-scroll">
            <table>
              <thead><tr><th>Market</th><th>Stock token</th><th>Feed</th><th>VigilOracle</th><th>Morpho market id</th></tr></thead>
              <tbody>
                {MARKETS.map((m) => (
                  <tr key={m.id}>
                    <td><b>{m.symbol}</b> / USDG</td>
                    <td><a href={explorerAddress(m.asset)} target="_blank" rel="noreferrer" title={m.asset}><code>{shortAddr(m.asset)}</code></a></td>
                    <td><a href={explorerAddress(m.feed)} target="_blank" rel="noreferrer" title={m.feed}><code>{shortAddr(m.feed)}</code></a></td>
                    <td><a href={explorerAddress(m.oracle)} target="_blank" rel="noreferrer" title={m.oracle}><code>{shortAddr(m.oracle)}</code></a></td>
                    <td><code title={m.id}>{m.id.slice(0, 10)}…{m.id.slice(-6)}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
