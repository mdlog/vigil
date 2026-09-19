import { el, setText } from '../ui/dom';
import { SYMBOL } from '../deployment';
import { fmtAge, fmtDuration, fmtUsd, premiumPer1000, usdg6 } from '../ui/format';
import { REGIME_NAMES } from '../ui/time';
import type { Panel } from './types';

export function createEconomy(): Panel {
  const idx = el('p', { class: 'big', text: '—' });
  const idxNote = el('p', { class: 'muted', text: '' });
  const prem = el('p', { class: 'big accent', text: '—' });
  const premNote = el('p', { class: 'muted', text: '' });
  const bsAssets = el('p', { class: 'big', text: '—' });
  const bsNote = el('p', { class: 'muted', text: '' });
  const mkt = el('p', { class: 'big', text: '—' });
  const mktNote = el('p', { class: 'muted', text: '' });
  const root = el('section', { class: 'panel reveal', id: 'economy' },
    el('p', { class: 'kicker', text: '03 · Premium, backstop, market' }),
    el('div', { class: 'econ-grid' },
      el('div', { class: 'tile' }, el('p', { class: 'kicker', text: 'Premium index' }), idx, idxNote),
      el('div', { class: 'tile' }, el('p', { class: 'kicker', text: 'Premium for this closure' }), prem, premNote),
      el('div', { class: 'tile' }, el('p', { class: 'kicker', text: 'Backstop · first-loss ERC-4626' }), bsAssets, bsNote),
      el('div', { class: 'tile' }, el('p', { class: 'kicker', text: `Morpho market ${SYMBOL}/USDG · LLTV 86 %` }), mkt, mktNote),
    ),
  );
  return {
    root,
    render(s, meta) {
      if (!s) return;
      const nowSec = Math.floor(meta.nowMs / 1000);
      setText(idx, `${fmtUsd(premiumPer1000(s.premiumIndex), 4)} USDG`);
      setText(idxNote, `per 1,000 USDG borrowed, accrued since deployment (∫ π_ref dt) · last persisted ${fmtAge(nowSec - s.lastPoke)}`);
      const perThousand = premiumPer1000(s.refRatePerSecond * BigInt(s.closureLen));
      const regimeForRate = REGIME_NAMES[s.regime === 0 ? 3 : s.regime];
      setText(prem, `${fmtUsd(perThousand, 3)} USDG`);
      setText(premNote, `per 1,000 USDG borrowed at the reference buffer · ${regimeForRate} rate over L = ${(s.closureLen / 3600).toFixed(1)} h (${fmtDuration(s.closureLen)})`);
      setText(bsAssets, `${fmtUsd(usdg6(s.backstopAssets), 0)} USDG`);
      setText(bsNote, `coverage cap ${fmtUsd(usdg6(s.coverageCap), 0)} USDG · covered so far ${fmtUsd(usdg6(s.totalCovered), 2)} · exit cooldown ${fmtDuration(s.cooldown)}`);
      const supply = usdg6(s.supplyAssets);
      const borrow = usdg6(s.borrowAssets);
      setText(mkt, `${fmtUsd(borrow, 0)} / ${fmtUsd(supply, 0)}`);
      setText(mktNote, `USDG borrowed / supplied · utilisation ${supply > 0 ? ((borrow / supply) * 100).toFixed(1) : '0.0'} % · last update ${fmtAge(nowSec - s.marketLastUpdate)}`);
    },
  };
}
