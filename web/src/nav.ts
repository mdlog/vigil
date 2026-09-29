/** The dashboard's tab lives in the URL hash, so a link — or the video recorder — can open a tab directly. */
export const TABS = ['overview', 'market-risk', 'contracts', 'use-it'] as const;
export type Tab = (typeof TABS)[number];

export const TAB_LABEL: Record<Tab, string> = {
  overview: 'Overview',
  'market-risk': 'Market risk',
  contracts: 'Contracts',
  'use-it': 'Use it',
};

/** The tab and, after `?m=`, the market's ticker — both in the hash, so a link opens a market's tab directly. */
export interface Route { tab: Tab; market: string | null }

/** '#use-it?m=amd' → { tab: 'use-it', market: 'AMD' }; an unknown tab → overview, no m → null. */
export function routeFromHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const tab = (TABS as readonly string[]).includes(path) ? (path as Tab) : 'overview';
  const m = new URLSearchParams(query).get('m');
  return { tab, market: m ? m.toUpperCase() : null };
}

/** '#use-it' → 'use-it'; anything unknown or empty → 'overview'. */
export function tabFromHash(hash: string): Tab {
  return routeFromHash(hash).tab;
}

export function hashOf(tab: Tab, market?: string | null): string {
  return market ? `#${tab}?m=${market}` : `#${tab}`;
}

/**
 * The landing used to be the dashboard: a link or recorder command carrying ?rpc= or ?poll= must still land on live
 * data. Returns the dashboard URL to replace the location with, or null when the landing should stay.
 */
export function legacyDashboardUrl(loc: { pathname: string; search: string; hash: string }): string | null {
  const q = new URLSearchParams(loc.search);
  if (!q.has('rpc') && !q.has('poll')) return null;
  const dir = loc.pathname.replace(/index\.html$/, '');
  const base = dir.endsWith('/') ? dir : `${dir}/`;
  return `${base}dashboard/${loc.search}${loc.hash}`;
}
