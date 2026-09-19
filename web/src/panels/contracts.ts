import { el, svgEl } from '../ui/dom';
import { ADDR, CONTRACT_ORDER, MARKET_ID, SYMBOL, TX_OF, explorerAddress, explorerTx, type ContractName } from '../deployment';
import { shortAddr } from '../ui/format';
import type { Panel } from './types';

const ROLE: Record<ContractName, string> = {
  VigilCalendar: 'NYSE session calendar from block.timestamp (DST, holidays)',
  VigilSessionOracle: 'effective regime, feed freshness, keeper attestations, premium index',
  VigilRiskEngine: 'haircut surface H(L), scheduled events, premium tables',
  VigilOracle: 'Morpho IOracle: feed × (1 − min(H, cap))',
  VigilPremium: 'USDG premium escrow and membership',
  VigilBackstop: 'ERC-4626 first-loss tranche',
  VigilPreLiquidation: 'session-aware soft unwind (Morpho PreLiquidation pattern)',
  VigilLossReporter: 'liquidateWithCover: the backstop repays the shortfall before seizure',
  Morpho: 'Morpho Blue, deployed from source (the testnet has none)',
  USDG: 'Global Dollar — the real Paxos USDG issued on the testnet (faucet.paxos.com), 6 decimals',
  MockUSDG: 'mock loan token, 6 decimals',
  StockToken: `Robinhood's own ${SYMBOL} stock token on the testnet (ERC-8056, registry 0x1dF3…6Ca5) — the collateral`,
  MockStockToken: `mock ERC-8056 ${SYMBOL} stock token`,
  MockFeed: `mock Chainlink ${SYMBOL}/USD feed, 8 decimals (the testnet has no Chainlink feeds)`,
  MockIRM: 'mock interest rate model',
};

function flow(): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 900 300', class: 'flow', role: 'img', 'aria-label': 'How Vigil attaches to a Morpho market' });
  const defs = svgEl('defs');
  const marker = svgEl('marker', { id: 'arrowhead', markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto', markerUnits: 'userSpaceOnUse' });
  marker.append(svgEl('path', { d: 'M0 0 L8 4 L0 8 z', class: 'flow-head' }));
  defs.append(marker);
  svg.append(defs);
  const box = (x: number, y: number, w: number, h: number, label: string, cls = '') => {
    svg.append(svgEl('rect', { x, y, width: w, height: h, rx: 8, class: `flow-box ${cls}` }));
    const t = svgEl('text', { x: x + w / 2, y: y + h / 2 + 4, 'text-anchor': 'middle', class: 'flow-text' });
    t.textContent = label;
    svg.append(t);
  };
  const arrow = (x1: number, y: number, x2: number, label?: string) => {
    svg.append(svgEl('line', { x1, y1: y, x2, y2: y, class: 'flow-arrow', 'marker-end': 'url(#arrowhead)' }));
    if (label) {
      const t = svgEl('text', { x: (x1 + x2) / 2, y: y - 8, 'text-anchor': 'middle', class: 'flow-label' });
      t.textContent = label;
      svg.append(t);
    }
  };
  const B = 36;
  // row 1 — the price path
  box(0, 12, 120, B, 'Calendar'); arrow(120, 30, 158);
  box(160, 12, 160, B, 'SessionOracle'); arrow(320, 30, 358);
  box(360, 12, 140, B, 'RiskEngine'); arrow(500, 30, 538);
  box(540, 12, 120, B, 'Oracle'); arrow(660, 30, 718, 'price()');
  box(720, 12, 180, 268, 'Morpho market', 'flow-ext');
  // row 2 — premium → backstop → covered liquidation
  box(0, 128, 120, B, 'Premium'); arrow(120, 146, 158);
  box(160, 128, 160, B, 'Backstop'); arrow(320, 146, 358);
  box(360, 128, 180, B, 'LossReporter'); arrow(540, 146, 718, 'liquidateWithCover');
  // row 3 — soft unwind
  box(360, 244, 180, B, 'PreLiquidation'); arrow(540, 262, 718, 'soft unwind (members)');
  return svg;
}

export function createContracts(): Panel {
  const rows = CONTRACT_ORDER.map((name) => {
    const tx = TX_OF[name];
    return el('tr', {},
      el('td', { class: 'mono', text: name }),
      el('td', { text: ROLE[name] }),
      el('td', { class: 'mono' }, el('a', { href: explorerAddress(ADDR[name]), target: '_blank', rel: 'noopener', text: shortAddr(ADDR[name]), title: ADDR[name] })),
      el('td', { class: 'mono' }, tx
        ? el('a', { href: explorerTx(tx), target: '_blank', rel: 'noopener', text: 'deploy tx ↗' })
        : el('span', { class: 'muted', text: name === 'USDG' ? 'issued by Paxos' : 'issued by Robinhood' })),
    );
  });
  const root = el('section', { class: 'panel reveal', id: 'contracts' },
    el('p', { class: 'kicker', text: '05 · Architecture and contracts' }),
    el('p', { class: 'muted', text: 'Vigil is not a lending protocol: it attaches to an unmodified Morpho Blue market through the oracle, and adds a premium, a first-loss tranche, a soft unwind and a covered liquidation around it.' }),
    el('div', { class: 'chart-wrap' }, flow()),
    el('div', { class: 'table-wrap' },
      el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, ...['Contract', 'Role', 'Address', ''].map((h) => el('th', { text: h })))),
        el('tbody', {}, ...rows))),
    el('p', { class: 'muted mono break', text: `Morpho market id ${MARKET_ID}` }),
  );
  return { root, render() {} };
}
