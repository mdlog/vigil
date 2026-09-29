import { ArrowUpRight, Radio } from 'lucide-react';
import { DEPLOYED_AT, NETWORK_NAME, explorerAddress, type Market } from '../deployment';
import type { Tab } from '../nav';

const TITLE: Record<Tab, string> = { overview: 'System overview', 'market-risk': 'Market risk', contracts: 'Contracts', 'use-it': 'Use it' };

export function PageTitle({ tab, market }: { tab: Tab; market: Market }) {
  return (
    <div className="dashboard-page-title">
      <div>
        <span className="dashboard-kicker"><Radio size={14} /> SESSION-AWARE RISK MONITOR</span>
        <h1>{TITLE[tab]}</h1>
        <p>{market.symbol} / USDG · {NETWORK_NAME} · deployed {DEPLOYED_AT.slice(0, 10)}</p>
      </div>
      <a className="dashboard-action" href={explorerAddress(market.oracle)} target="_blank" rel="noreferrer">View oracle on explorer <ArrowUpRight size={15} /></a>
    </div>
  );
}
