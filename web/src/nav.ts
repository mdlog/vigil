/** The dashboard's tab lives in the URL hash, so a link — or the video recorder — can open a tab directly. */
export const TABS = ['overview', 'market-risk', 'contracts', 'use-it'] as const;
export type Tab = (typeof TABS)[number];

export const TAB_LABEL: Record<Tab, string> = {
  overview: 'Overview',
  'market-risk': 'Market risk',
  contracts: 'Contracts',
  'use-it': 'Use it',
};

/** '#use-it' → 'use-it'; anything unknown or empty → 'overview'. */
export function tabFromHash(hash: string): Tab {
  const h = hash.replace(/^#/, '');
  return (TABS as readonly string[]).includes(h) ? (h as Tab) : 'overview';
}

export function hashOf(tab: Tab): string {
  return `#${tab}`;
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
