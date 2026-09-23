import { useEffect, useState } from 'react';
import { hashOf, tabFromHash, type Tab } from '../nav';
import { useNow } from '../hooks/useNow';
import { useSnapshot } from '../hooks/useSnapshot';
import { useWallet } from '../hooks/useWallet';
import { syncStatus } from '../view/status';
import { Banner } from './Banner';
import { Footer } from './Footer';
import { PageTitle } from './PageTitle';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Contracts } from './tabs/Contracts';
import { MarketRisk } from './tabs/MarketRisk';
import { Overview } from './tabs/Overview';
import { UseIt } from './tabs/UseIt';

export function App() {
  const [tab, setTab] = useState<Tab>(() => tabFromHash(location.hash));
  const [menuOpen, setMenuOpen] = useState(false);
  const live = useSnapshot();
  const wallet = useWallet(); // at the root, so switching tabs never drops the connection
  const nowMs = useNow(1000);
  const status = syncStatus(live.snapshot !== null, live.lastOkMs, live.error, nowMs);

  // back / forward between tabs
  useEffect(() => {
    const sync = () => setTab(tabFromHash(location.hash));
    addEventListener('hashchange', sync);
    addEventListener('popstate', sync);
    return () => {
      removeEventListener('hashchange', sync);
      removeEventListener('popstate', sync);
    };
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    setMenuOpen(false);
    if (location.hash !== hashOf(t)) history.pushState(null, '', hashOf(t)); // no jump to an anchor
  };

  return (
    <div className="dashboard-shell">
      <Sidebar tab={tab} onTab={go} open={menuOpen} onClose={() => setMenuOpen(false)} status={status} lastOkMs={live.lastOkMs} nowMs={nowMs} />
      <div className="dashboard-main">
        <Topbar tab={tab} status={status} onMenu={() => setMenuOpen(true)} wallet={wallet} />
        <main className="dashboard-content">
          <Banner status={status} error={live.error} lastOkMs={live.lastOkMs} />
          <PageTitle tab={tab} />
          {tab === 'overview' && <Overview live={live} nowMs={nowMs} />}
          {tab === 'market-risk' && <MarketRisk live={live} nowMs={nowMs} />}
          {tab === 'contracts' && <Contracts />}
          {tab === 'use-it' && <UseIt wallet={wallet} snapshot={live.snapshot} nowMs={nowMs} />}
          <Footer />
        </main>
      </div>
    </div>
  );
}
