import { el, setText } from '../ui/dom';
import { fmtAge, fmtDuration } from '../ui/format';
import { countdown, etClock, etDateTime, REGIME_NAMES } from '../ui/time';
import type { Panel } from './types';

const REGIME_BLURB: Record<number, string> = {
  0: 'regular session — no haircut, no premium',
  1: 'extended hours — thin liquidity, haircut ramping',
  2: 'overnight — feed frozen until the next open',
  3: 'closed — derived on-chain from the NYSE calendar',
  4: 'corporate action — the oracle refuses to price',
};

export function createSession(): Panel {
  const pill = el('div', { class: 'annunciator', role: 'status' }, el('span', { class: 'annunciator-lamp', 'aria-hidden': 'true' }), el('span', { class: 'annunciator-text', text: '—' }));
  const pillText = pill.querySelector('.annunciator-text')!;
  const calNote = el('p', { class: 'muted', text: 'waiting for the chain…' });
  const clock = el('p', { class: 'clock', text: '' });
  const nextLabel = el('p', { class: 'kicker', text: 'Next transition' });
  const nextValue = el('p', { class: 'big', text: '—' });
  const nextAt = el('p', { class: 'muted', text: '' });
  const progressFill = el('span', { class: 'progress-fill' });
  const progress = el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, progressFill);
  const lenValue = el('p', { class: 'big', text: '—' });
  const lenNote = el('p', { class: 'muted', text: 'from last close to next open — the only input the haircut needs' });
  const feedValue = el('p', { class: 'big', text: '—' });
  const feedNote = el('p', { class: 'muted', text: '' });
  const root = el('section', { class: 'panel hero reveal', id: 'session' },
    el('div', { class: 'hero-left' },
      el('p', { class: 'kicker', text: '01 · Exchange session right now' }),
      pill, calNote, clock,
    ),
    el('div', { class: 'hero-grid' },
      el('div', { class: 'tile' }, nextLabel, nextValue, nextAt, progress),
      el('div', { class: 'tile' }, el('p', { class: 'kicker', text: 'Closure length L' }), lenValue, lenNote),
      el('div', { class: 'tile' }, el('p', { class: 'kicker', text: 'Price feed' }), feedValue, feedNote),
    ),
  );
  return {
    root,
    render(s, meta) {
      setText(clock, etClock(meta.nowMs));
      if (!s) return;
      const nowSec = Math.floor(meta.nowMs / 1000);
      const name = REGIME_NAMES[s.regime] ?? String(s.regime);
      setText(pillText, name);
      pill.className = `annunciator regime-${s.regime}`;
      setText(calNote, s.regime !== s.calRegime
        ? `calendar says ${REGIME_NAMES[s.calRegime]} — tightened by ${s.tightSince ? 'a keeper attestation' : 'feed freshness'}`
        : REGIME_BLURB[s.regime] ?? '');
      const closed = s.regime !== 0;
      setText(nextLabel, closed ? 'Opens in' : 'Closes in');
      const target = closed ? s.nextOpen : s.closeAt;
      const start = closed ? s.closeAt : s.lastOpen;
      setText(nextValue, fmtDuration(countdown(nowSec, target)));
      setText(nextAt, etDateTime(target));
      const span = Math.max(1, target - start);
      const pct = Math.min(100, Math.max(0, ((nowSec - start) / span) * 100));
      progressFill.style.width = `${pct.toFixed(2)}%`;
      progress.setAttribute('aria-valuenow', pct.toFixed(0));
      setText(lenValue, `${(s.closureLen / 3600).toFixed(1)} h`);
      setText(feedValue, s.feedUsable ? 'usable' : 'not usable');
      feedValue.className = `big ${s.feedUsable ? '' : 'warn'}`;
      setText(feedNote, `last update ${fmtAge(nowSec - s.feedUpdatedAt)}${closed ? ' — frozen while closed is the expected state' : ''}`);
    },
  };
}
