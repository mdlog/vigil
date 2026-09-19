import { el, setText } from '../ui/dom';
import { ADDR, CHAIN_ID, EXPLORER } from '../deployment';
import { isStale } from '../ui/poll';
import type { Panel } from './types';

export function createHeader(): Panel {
  const status = el('span', { class: 'badge badge-wait' }, el('i', { class: 'lamp' }), el('span', { class: 'badge-text', text: 'connecting' }));
  const statusText = status.querySelector('.badge-text')!;
  const root = el('header', { class: 'site-header reveal' },
    el('div', { class: 'brand' },
      el('span', { class: 'brand-mark', 'aria-hidden': 'true', text: 'V' }),
      el('div', {},
        el('h1', { text: 'Vigil' }),
        el('p', { class: 'tagline', text: 'Session-aware collateral risk for tokenized equity on Morpho Blue' }),
      ),
    ),
    el('div', { class: 'header-right' },
      el('span', { class: 'badge', text: `Robinhood Chain testnet · ${CHAIN_ID}` }),
      status,
      el('a', { class: 'link', href: 'https://github.com/mdlog/vigil', target: '_blank', rel: 'noopener', text: 'GitHub ↗' }),
      el('a', { class: 'link', href: `${EXPLORER}/address/${ADDR.VigilOracle}`, target: '_blank', rel: 'noopener', text: 'Explorer ↗' }),
    ),
  );
  return {
    root,
    render(s, meta) {
      const stale = meta.lastOkMs === null || isStale(meta.lastOkMs, meta.nowMs);
      const state = s === null ? 'wait' : stale ? 'stale' : 'live';
      setText(statusText, s === null ? 'connecting' : stale ? 'stale' : 'live');
      status.className = `badge badge-${state}`;
    },
  };
}
