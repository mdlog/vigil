import { ExternalLink, Menu } from 'lucide-react';
import { ADDR, explorerAddress } from '../deployment';
import { TAB_LABEL, type Tab } from '../nav';
import type { SyncStatus } from '../view/status';

/** `.badge-text` carries connecting | live | stale | offline — the video recorder waits for "live". */
export function Topbar({ tab, status, onMenu }: { tab: Tab; status: SyncStatus; onMenu: () => void }) {
  return (
    <header className="dashboard-topbar">
      <button className="dashboard-menu" type="button" onClick={onMenu} aria-label="Open dashboard menu"><Menu size={20} /></button>
      <div className="dashboard-breadcrumb"><a href={import.meta.env.BASE_URL}>Vigil</a><span>/</span><b>{TAB_LABEL[tab]}</b></div>
      <div className="dashboard-top-actions">
        <span className="sync-status" data-status={status} role="status"><i /> <span className="badge-text">{status}</span></span>
        <a href={explorerAddress(ADDR.VigilOracle)} target="_blank" rel="noreferrer">Explorer <ExternalLink size={13} /></a>
      </div>
    </header>
  );
}
