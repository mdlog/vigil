import { el } from '../ui/dom';
import type { Panel } from './types';

const ROWS: [string, string, string, string][] = [
  ['5 Aug 2024 · NVDA 107.27 → 92.06 (−14.18 %)', '40.59 USDG per 1,072 USDG position', '0', 'member unwound Friday 15:00 to 76 % LTV at a 1.5 % discount; 500 bps haircut over the weekend; 0.07 USDG premium'],
  ['27 Jan 2025 · NVDA 142.62 → 124.80 (−12.49 %)', '30.95 USDG per position', '0', 'same path'],
  ['Max-LTV member hit by −12 % at Monday 10:00', '—', '0', '70.12 USDG shortfall paid by the backstop inside the liquidation transaction; suppliers untouched'],
];

export function createEvidence(): Panel {
  const table = el('table', { class: 'table table-evidence' },
    el('colgroup', {}, el('col', { style: 'width:30%' }), el('col', { style: 'width:20%' }), el('col', { style: 'width:12%' }), el('col', { style: 'width:38%' })),
    el('thead', {}, el('tr', {}, ...['Replay', 'Control market · bad debt', 'Vigil market · bad debt', 'What Vigil did'].map((h) => el('th', { text: h })))),
    el('tbody', {}, ...ROWS.map((r) => el('tr', {}, ...r.map((c, i) => el('td', { class: i === 2 ? 'zero' : i === 0 ? 'mono wrap' : undefined, text: c }))))),
  );
  const root = el('section', { class: 'panel reveal', id: 'evidence' },
    el('p', { class: 'kicker', text: '05 · Why this exists' }),
    el('p', { class: 'lede', text: 'In four years of NVDA data, both gaps that would have created bad debt in an 86 % LLTV market happened at Monday open — after a weekend in which the price feed did not move and no liquidation could execute. Utilization-based interest charged nothing for either.' }),
    el('div', { class: 'table-wrap' }, table),
    el('p', { class: 'muted' }, 'Two identical Morpho Blue markets replayed on Anvil with the production contracts and the real dates — ',
      el('a', { href: 'https://github.com/mdlog/vigil/blob/main/script/Demo.s.sol', target: '_blank', rel: 'noopener', text: 'script/Demo.s.sol' }), '.'),
  );
  return { root, render() {} };
}
