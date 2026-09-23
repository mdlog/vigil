import { Fragment } from 'react';
import { ExternalLink, Github, TerminalSquare, X } from 'lucide-react';
import { Brand } from '../Brand';
import { ADDR, CHAIN_ID, IS_TESTNET, NETWORK_NAME, explorerAddress } from '../deployment';
import { TABS, TAB_LABEL, type Tab } from '../nav';
import { fmtAge } from '../ui/format';
import type { SyncStatus } from '../view/status';

const HEALTH: Record<SyncStatus, string> = {
  connecting: 'CONNECTING TO THE CHAIN',
  live: 'LIVE · READING THE CHAIN',
  stale: 'STALE · RPC NOT ANSWERING',
  offline: 'OFFLINE · RPC UNREACHABLE',
};
const GROUP: Record<Tab, string> = { overview: 'MONITOR', 'market-risk': 'MONITOR', contracts: 'MONITOR', 'use-it': 'ACT' };

export function Sidebar(props: { tab: Tab; onTab: (t: Tab) => void; open: boolean; onClose: () => void; status: SyncStatus; lastOkMs: number | null; nowMs: number }) {
  const { tab, onTab, open, onClose, status, lastOkMs, nowMs } = props;
  const chainName = NETWORK_NAME.replace(/\s*testnet$/i, '').toUpperCase();
  return (
    <aside className={open ? 'dashboard-sidebar open' : 'dashboard-sidebar'} aria-label="Dashboard navigation">
      <div className="dashboard-sidebar-head">
        <Brand href={import.meta.env.BASE_URL} />
        <button className="dashboard-close" type="button" onClick={onClose} aria-label="Close menu"><X size={19} /></button>
      </div>
      <div className="sidebar-network">
        <span className={status === 'live' ? 'pulse-dot' : 'pulse-dot off'} />
        <div><b>{chainName}</b><small>{IS_TESTNET ? 'TESTNET' : 'MAINNET'} · {CHAIN_ID}</small></div>
      </div>
      <nav className="dashboard-nav" aria-label="Dashboard tabs">
        {TABS.map((t, i) => (
          <Fragment key={t}>
            {(i === 0 || GROUP[t] !== GROUP[TABS[i - 1]!]) && <small className={i === 0 ? undefined : 'nav-spacer'}>{GROUP[t]}</small>}
            <button type="button" className={tab === t ? 'active' : undefined} aria-current={tab === t ? 'page' : undefined} onClick={() => onTab(t)}>
              {TAB_LABEL[t]}<span>0{i + 1}</span>
            </button>
          </Fragment>
        ))}
        <small className="nav-spacer">RESOURCES</small>
        <a href="https://github.com/mdlog/vigil" target="_blank" rel="noreferrer"><Github size={16} /> Repository <ExternalLink size={13} /></a>
        <a href={explorerAddress(ADDR.VigilOracle)} target="_blank" rel="noreferrer"><TerminalSquare size={16} /> Block explorer <ExternalLink size={13} /></a>
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-health" data-status={status}>
          <span />
          <div><b>{HEALTH[status]}</b><small>{lastOkMs === null ? 'no successful read yet' : `last read ${fmtAge((nowMs - lastOkMs) / 1000)}`}</small></div>
        </div>
        <a href={import.meta.env.BASE_URL}>← Vigil home</a>
      </div>
    </aside>
  );
}
