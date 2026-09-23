import { ArrowUpRight } from 'lucide-react';
import type { HeroView } from '../view/status';

/** The hero card: live numbers from the testnet deployment over a drawing of the pre-close haircut ramp. */
export function LiveHero({ view, href }: { view: HeroView; href: string }) {
  return (
    <div className="risk-card" aria-label={`Vigil oracle for ${view.pair} on Robinhood Chain testnet`}>
      <div className="risk-card-glow" />
      <div className="risk-card-top">
        <div><span className="eyebrow tiny">SESSION-AWARE PROTECTION</span><h2>{view.pair}</h2></div>
        <div className={view.live ? 'live-pill' : 'live-pill off'} data-status={view.live ? 'live' : 'off'}><b /> {view.pill}</div>
      </div>
      <div className="metric-row">
        <div><small>Vigil oracle · USDG per {view.symbol}</small><strong>{view.price}</strong></div>
        <div className="metric-delta"><small>Haircut</small><b>{view.haircut}</b></div>
      </div>
      <div className="chart-wrap">
        <div className="chart-y"><span className="illustrative">ILLUSTRATIVE</span></div>
        <svg viewBox="0 0 520 210" className="risk-chart" role="img" aria-label="Illustration: the feed price and the Vigil price as the pre-close haircut ramps in">
          <defs>
            <linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#f3ba56" stopOpacity=".25" /><stop offset="1" stopColor="#f3ba56" stopOpacity="0" /></linearGradient>
            <linearGradient id="line" x1="0" x2="1"><stop offset="0" stopColor="#85e8d1" /><stop offset="1" stopColor="#f3ba56" /></linearGradient>
          </defs>
          <g className="chart-grid"><line x1="14" y1="24" x2="506" y2="24" /><line x1="14" y1="76" x2="506" y2="76" /><line x1="14" y1="128" x2="506" y2="128" /><line x1="14" y1="180" x2="506" y2="180" /></g>
          <path className="chart-area" d="M14 98 C72 93 104 83 152 91 S236 90 276 104 C324 121 344 129 386 138 S452 149 506 157 L506 180 L14 180Z" />
          <path className="chart-line raw" d="M14 98 C72 93 104 83 152 91 S236 90 276 104 C324 121 344 129 386 138 S452 149 506 157" />
          <path className="chart-line" d="M14 98 C72 93 104 83 152 91 S236 90 276 104 C294 112 316 122 336 120 S378 119 404 130 S460 142 506 149" />
          <line className="session-line" x1="286" y1="20" x2="286" y2="181" />
          <circle className="chart-dot outer" cx="336" cy="120" r="10" />
          <circle className="chart-dot" cx="336" cy="120" r="5" />
        </svg>
        <div className="chart-x"><span>FRI 12:00</span><span className="active">PRE-CLOSE</span><span>MARKET CLOSED</span><span>MON 09:30</span></div>
      </div>
      <a className="risk-card-bottom" href={href}><span><i /> Regime now: <b>{view.regime}</b></span><ArrowUpRight size={15} /></a>
    </div>
  );
}
