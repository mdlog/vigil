import { el, setText, svgEl } from '../ui/dom';
import { feedToUsd, fmtBps, fmtUsd, priceToUsdg } from '../ui/format';
import { linePath, makeScale, niceMaxBps } from '../ui/svg';
import { MARKERS, type CurvePoint } from '../chain/curve';
import { SYMBOL } from '../deployment';
import type { Snapshot } from '../chain/snapshot';
import type { Panel } from './types';

const W = 680, H = 280, PAD_L = 44, PAD_R = 16, PAD_T = 28, PAD_B = 34;

export function createPrice(): Panel & { setCurve(c: CurvePoint[]): void } {
  const feedV = el('p', { class: 'big', text: '—' });
  const vigilV = el('p', { class: 'big accent', text: '—' });
  const vigilNote = el('p', { class: 'muted', text: '' });
  const hcNow = el('p', { class: 'big', text: '—' });
  const hcNote = el('p', { class: 'muted', text: '' });

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'curve', role: 'img', 'aria-label': 'Haircut as a function of closure length, computed on-chain' });
  const gridG = svgEl('g', { class: 'grid' });
  const refG = svgEl('g', { class: 'refs' });
  const area = svgEl('path', { class: 'curve-area', d: '' });
  const path = svgEl('path', { class: 'curve-line', d: '' });
  const markG = svgEl('g', { class: 'markers' });
  const cross = svgEl('line', { class: 'crosshair', x1: -10, x2: -10, y1: PAD_T, y2: H - PAD_B, visibility: 'hidden' });
  const hoverDot = svgEl('circle', { class: 'hover-dot', r: 5, cx: -10, cy: -10, visibility: 'hidden' });
  const cur = svgEl('circle', { class: 'current', r: 6, cx: -10, cy: -10 });
  const curLabel = svgEl('text', { class: 'current-label', x: -10, y: -10 });
  svg.append(gridG, refG, area, path, markG, cross, hoverDot, cur, curLabel);
  const tooltip = el('div', { class: 'tooltip hidden', role: 'tooltip' });
  const chartWrap = el('div', { class: 'chart-wrap' }, svg, tooltip);

  const root = el('section', { class: 'panel reveal', id: 'price' },
    el('p', { class: 'kicker', text: '02 · Price' }),
    el('div', { class: 'price-grid' },
      el('div', { class: 'tile' }, el('p', { class: 'kicker', text: `Raw feed · ${SYMBOL}/USD` }), feedV, el('p', { class: 'muted', text: 'what a plain Chainlink oracle reports' })),
      el('div', { class: 'tile' }, el('p', { class: 'kicker', text: `Vigil oracle · USDG per ${SYMBOL}` }), vigilV, vigilNote),
      el('div', { class: 'tile' }, el('p', { class: 'kicker', text: 'Haircut in force' }), hcNow, hcNote),
    ),
    el('div', { class: 'chart-head' },
      el('p', { class: 'chart-title', text: 'Haircut H(L) by closure length' }),
      el('p', { class: 'muted', text: 'H(L) = clamp(H_floor + k·σ·√(L / τ_night)); 64 points evaluated by VigilRiskEngine.closureHaircutBps on-chain. The market oracle applies min(H, cap).' }),
    ),
    chartWrap,
  );

  let curve: CurvePoint[] = [];
  let last: Snapshot | null = null;
  let scale = makeScale(W, H, 0, 1, 1);
  let maxL = 1;

  function drawCurve() {
    if (curve.length === 0 || !last) return;
    maxL = curve[curve.length - 1]!.L;
    const maxBps = niceMaxBps(Math.max(curve[curve.length - 1]!.bps, last.capBps));
    const s = {
      x: (L: number) => PAD_L + (L / maxL) * (W - PAD_L - PAD_R),
      y: (bps: number) => PAD_T + (H - PAD_T - PAD_B) - (bps / maxBps) * (H - PAD_T - PAD_B),
    };
    scale = s;
    gridG.replaceChildren();
    refG.replaceChildren();
    markG.replaceChildren();
    for (let bps = 0; bps <= maxBps; bps += 500) {
      const y = s.y(bps);
      gridG.append(svgEl('line', { x1: PAD_L, x2: W - PAD_R, y1: y, y2: y }));
      const t = svgEl('text', { x: PAD_L - 8, y: y + 4, 'text-anchor': 'end' });
      t.textContent = `${bps / 100}%`;
      gridG.append(t);
    }
    for (let hours = 0; hours <= maxL / 3600; hours += 24) {
      const x = s.x(hours * 3600);
      gridG.append(svgEl('line', { x1: x, x2: x, y1: H - PAD_B, y2: H - PAD_B + 4 }));
      const t = svgEl('text', { x, y: H - PAD_B + 18, 'text-anchor': 'middle' });
      t.textContent = hours === 0 ? '0' : `${hours}h`;
      gridG.append(t);
    }
    const ref = (bps: number, label: string, cls: string) => {
      const y = s.y(bps);
      refG.append(svgEl('line', { class: cls, x1: PAD_L, x2: W - PAD_R, y1: y, y2: y }));
      const t = svgEl('text', { class: cls, x: W - PAD_R, y: y - 5, 'text-anchor': 'end' });
      t.textContent = label;
      refG.append(t);
    };
    ref(last.capBps, `market cap ${fmtBps(last.capBps)}`, 'ref-cap');
    ref(last.surface.hFloorBps, `floor ${fmtBps(last.surface.hFloorBps)}`, 'ref-floor');
    const d = linePath(curve, s);
    path.setAttribute('d', d);
    area.setAttribute('d', `${d} L${s.x(maxL)} ${s.y(0)} L${s.x(0)} ${s.y(0)} Z`);
    for (const m of MARKERS) {
      const pt = curve.find((q) => q.L === m.L) ?? curve.reduce((a, b) => (Math.abs(b.L - m.L) < Math.abs(a.L - m.L) ? b : a));
      const x = s.x(m.L);
      markG.append(svgEl('line', { x1: x, x2: x, y1: s.y(0), y2: s.y(pt.bps), class: 'marker-line' }));
      markG.append(svgEl('circle', { cx: x, cy: s.y(pt.bps), r: 4, class: 'marker-dot' }));
      const t = svgEl('text', { x, y: s.y(pt.bps) - 14, 'text-anchor': 'middle', class: 'marker-label' });
      t.textContent = `${m.label} ${(m.L / 3600).toFixed(1)}h · ${fmtBps(pt.bps)}`;
      markG.append(t);
    }
    const L = Math.min(last.closureLen, maxL);
    const yNow = s.y(Math.min(last.engineHaircutBps, maxBps));
    cur.setAttribute('cx', String(s.x(L)));
    cur.setAttribute('cy', String(yNow));
    const labelRight = s.x(L) < W * 0.6;
    curLabel.setAttribute('x', String(labelRight ? s.x(L) + 10 : s.x(L) - 10));
    curLabel.setAttribute('text-anchor', labelRight ? 'start' : 'end');
    curLabel.setAttribute('y', String(yNow + 18));
    curLabel.textContent = `now · L ${(L / 3600).toFixed(1)}h → ${fmtBps(last.engineHaircutBps)}`;
  }

  function hover(ev: PointerEvent) {
    if (curve.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const xPx = ((ev.clientX - rect.left) / rect.width) * W;
    const Lraw = ((xPx - PAD_L) / (W - PAD_L - PAD_R)) * maxL;
    if (Lraw < 0 || Lraw > maxL) return hide();
    const pt = curve.reduce((a, b) => (Math.abs(b.L - Lraw) < Math.abs(a.L - Lraw) ? b : a));
    const x = scale.x(pt.L);
    const y = scale.y(pt.bps);
    cross.setAttribute('x1', String(x)); cross.setAttribute('x2', String(x)); cross.setAttribute('visibility', 'visible');
    hoverDot.setAttribute('cx', String(x)); hoverDot.setAttribute('cy', String(y)); hoverDot.setAttribute('visibility', 'visible');
    tooltip.textContent = `L = ${(pt.L / 3600).toFixed(0)} h → H = ${fmtBps(pt.bps)}${last ? ` · market applies ${fmtBps(Math.min(pt.bps, last.capBps))}` : ''}`;
    tooltip.classList.remove('hidden');
    const left = (x / W) * rect.width;
    tooltip.style.left = `${Math.min(rect.width - 8, Math.max(8, left))}px`;
    tooltip.style.top = `${(y / H) * rect.height - 36}px`;
  }
  function hide() {
    cross.setAttribute('visibility', 'hidden');
    hoverDot.setAttribute('visibility', 'hidden');
    tooltip.classList.add('hidden');
  }
  svg.addEventListener('pointermove', hover);
  svg.addEventListener('pointerleave', hide);

  return {
    root,
    setCurve(c) { curve = c; drawCurve(); },
    render(s) {
      if (!s) return;
      last = s;
      setText(feedV, fmtUsd(feedToUsd(s.feedAnswer)));
      if (s.price !== null) {
        setText(vigilV, fmtUsd(priceToUsdg(s.price)));
        setText(vigilNote, s.unhaircutPrice !== null ? `= ${fmtUsd(priceToUsdg(s.unhaircutPrice))} × (1 − ${fmtBps(s.haircutNowBps)})` : '');
      } else {
        setText(vigilV, 'reverting');
        setText(vigilNote, s.priceError ?? 'the oracle refuses to price (corporate action or unexpectedly stale feed)');
      }
      setText(hcNow, fmtBps(s.haircutNowBps));
      setText(hcNote, `engine H(L) ${fmtBps(s.engineHaircutBps)} for L = ${(s.closureLen / 3600).toFixed(1)} h, capped at ${fmtBps(s.capBps)} for the market${s.eventActive ? ' · scheduled event active' : ''}`);
      drawCurve();
    },
  };
}
