import { useEffect, useState } from 'react';
import { DEFAULT_MARKET, marketOf } from '../deployment';
import { hashOf, routeFromHash, type Route, type Tab } from '../nav';
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
  const [route, setRoute] = useState<Route>(() => routeFromHash(location.hash));
  const { tab } = route;
  const market = marketOf(route.market);
  const [menuOpen, setMenuOpen] = useState(false);
  const live = useSnapshot(market);
  const wallet = useWallet(market); // at the root, so switching tabs never drops the connection
  const nowMs = useNow(1000);
  const status = syncStatus(live.snapshot !== null, live.lastOkMs, live.error, nowMs);

  // back / forward between tabs
  useEffect(() => {
    const sync = () => setRoute(routeFromHash(location.hash));
    addEventListener('hashchange', sync);
    addEventListener('popstate', sync);
    return () => {
      removeEventListener('hashchange', sync);
      removeEventListener('popstate', sync);
    };
  }, []);
  // the default market stays out of the URL, so every link from before the picker is still canonical
  const mParam = market.id === DEFAULT_MARKET.id ? null : market.symbol;
  const go = (t: Tab) => {
    setRoute({ tab: t, market: mParam });
    setMenuOpen(false);
    const h = hashOf(t, mParam);
    if (location.hash !== h) history.pushState(null, '', h); // no jump to an anchor
  };
  const pick = (symbol: string) => {
    const m = marketOf(symbol);
    const mp = m.id === DEFAULT_MARKET.id ? null : m.symbol;
    setRoute({ tab, market: mp });
    wallet.clearStatus();
    const h = hashOf(tab, mp);
    if (location.hash !== h) history.pushState(null, '', h);
  };

  return (
    <div className="dashboard-shell">
      <Sidebar tab={tab} onTab={go} open={menuOpen} onClose={() => setMenuOpen(false)} status={status} lastOkMs={live.lastOkMs} nowMs={nowMs} />
      <div className="dashboard-main">
        <Topbar tab={tab} status={status} onMenu={() => setMenuOpen(true)} wallet={wallet} market={market} onPick={pick} />
        <main className="dashboard-content">
          <Banner status={status} error={live.error} lastOkMs={live.lastOkMs} />
          <PageTitle tab={tab} market={market} />
          {tab === 'overview' && <Overview live={live} nowMs={nowMs} market={market} />}
          {tab === 'market-risk' && <MarketRisk live={live} nowMs={nowMs} />}
          {tab === 'contracts' && <Contracts />}
          {tab === 'use-it' && <UseIt wallet={wallet} snapshot={live.snapshot} nowMs={nowMs} market={market} />}
          <Footer />
        </main>
      </div>
    </div>
  );
}
