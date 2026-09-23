/** What the dashboard's read-only panels show, as pure functions of a snapshot (ported from web/src/panels/*.ts @ 7f9d414). */
import type { Snapshot } from '../chain/snapshot';
import { feedToUsd, fmtAge, fmtBps, fmtDuration, fmtUsd, premiumPer1000, priceToUsdg, usdg6 } from '../ui/format';
import { countdown, etDateTime, REGIME_NAMES } from '../ui/time';

const REGIME_BLURB: Record<number, string> = {
  0: 'regular session — no haircut, no premium',
  1: 'extended hours — thin liquidity, haircut ramping',
  2: 'overnight — feed frozen until the next open',
  3: 'closed — derived on-chain from the NYSE calendar',
  4: 'corporate action — the oracle refuses to price',
};
const HEADLINE: Record<number, string> = {
  0: 'Market is open.',
  1: 'Extended hours.',
  2: 'Overnight — feed frozen.',
  3: 'Market is closed.',
  4: 'Corporate action — pricing paused.',
};
const regimeName = (r: number) => REGIME_NAMES[r] ?? String(r);
const hours = (sec: number) => `${(sec / 3600).toFixed(1)} h`;

export interface SessionView {
  regime: string; regimeClass: number; headline: string; note: string;
  nextLabel: 'Opens in' | 'Closes in'; countdown: string; nextAt: string; progressPct: number;
  closureHours: string; feedUsable: boolean; feedNote: string;
}

export function sessionView(s: Snapshot, nowMs: number): SessionView {
  const nowSec = Math.floor(nowMs / 1000);
  const closed = s.regime !== 0;
  const target = closed ? s.nextOpen : s.closeAt;
  const start = closed ? s.closeAt : s.lastOpen;
  const span = Math.max(1, target - start);
  return {
    regime: regimeName(s.regime),
    regimeClass: s.regime,
    headline: HEADLINE[s.regime] ?? '',
    note: s.regime !== s.calRegime
      ? `calendar says ${regimeName(s.calRegime)} — tightened by ${s.tightSince ? 'a keeper attestation' : 'feed freshness'}`
      : REGIME_BLURB[s.regime] ?? '',
    nextLabel: closed ? 'Opens in' : 'Closes in',
    countdown: fmtDuration(countdown(nowSec, target)),
    nextAt: etDateTime(target),
    progressPct: Math.min(100, Math.max(0, ((nowSec - start) / span) * 100)),
    closureHours: hours(s.closureLen),
    feedUsable: s.feedUsable,
    feedNote: `last update ${fmtAge(nowSec - s.feedUpdatedAt)}${closed ? ' — frozen while closed is the expected state' : ''}`,
  };
}

export interface OracleView { price: string; formula: string; feed: string; haircut: string; note: string; reverting: boolean }

/** Why price() reverted, out of viem's report: the custom error ("Error: VigilStale()"), the require() string after
 *  "…with the following reason:", or the selector after "…with the following signature:"; else the report's first line. */
export function revertReason(message: string | null): string {
  if (!message) return 'the oracle refuses to price (corporate action or unexpectedly stale feed)';
  const lines = message.split('\n').map((l) => l.trim());
  const custom = lines.find((l) => l.startsWith('Error: '));
  if (custom) return `price() reverts: ${custom.slice('Error: '.length)}`;
  const at = lines.findIndex((l) => /with the following (reason|signature):$/.test(l));
  const next = at >= 0 ? lines[at + 1] : undefined;
  return next ? `price() reverts: ${next}` : lines[0] ?? message;
}

export function oracleView(s: Snapshot): OracleView {
  const feed = fmtUsd(feedToUsd(s.feedAnswer));
  const haircut = fmtBps(s.haircutNowBps);
  const note = `engine H(L) ${fmtBps(s.engineHaircutBps)} for L = ${hours(s.closureLen)}, capped at ${fmtBps(s.capBps)} for the market${s.eventActive ? ' · scheduled event active' : ''}`;
  if (s.price === null) {
    return { price: 'reverting', formula: revertReason(s.priceError), feed, haircut, note, reverting: true };
  }
  const formula = s.unhaircutPrice !== null ? `= ${fmtUsd(priceToUsdg(s.unhaircutPrice))} × (1 − ${haircut})` : '';
  return { price: fmtUsd(priceToUsdg(s.price)), formula, feed, haircut, note, reverting: false };
}

export interface EconomyView {
  premiumIndex: string; premiumIndexNote: string; closurePremium: string; closurePremiumNote: string; backstop: string; backstopNote: string;
}

export function economyView(s: Snapshot, nowSec: number): EconomyView {
  const perThousand = premiumPer1000(s.refRatePerSecond * BigInt(s.closureLen));
  const regimeForRate = regimeName(s.regime === 0 ? 3 : s.regime); // MARKET charges nothing: show the closed-regime rate
  return {
    premiumIndex: `${fmtUsd(premiumPer1000(s.premiumIndex), 4)} USDG`,
    premiumIndexNote: `per 1,000 USDG borrowed, accrued since deployment (∫ π_ref dt) · last persisted ${fmtAge(nowSec - s.lastPoke)}`,
    closurePremium: `${fmtUsd(perThousand, 3)} USDG`,
    closurePremiumNote: `per 1,000 USDG borrowed at the reference buffer · ${regimeForRate} rate over L = ${hours(s.closureLen)} (${fmtDuration(s.closureLen)})`,
    backstop: `${fmtUsd(usdg6(s.backstopAssets), 0)} USDG`,
    backstopNote: `coverage cap ${fmtUsd(usdg6(s.coverageCap), 0)} USDG · covered so far ${fmtUsd(usdg6(s.totalCovered), 2)} · exit cooldown ${fmtDuration(s.cooldown)}`,
  };
}

export interface MarketView { supplied: string; borrowed: string; utilPct: number; util: string; lltv: string; lastUpdate: string }

export function marketView(s: Snapshot, nowSec: number, lltv: bigint | null): MarketView {
  const supply = usdg6(s.supplyAssets);
  const borrow = usdg6(s.borrowAssets);
  const utilPct = supply > 0 ? (borrow / supply) * 100 : 0;
  return {
    supplied: fmtUsd(supply, 0),
    borrowed: fmtUsd(borrow, 0),
    utilPct,
    util: `${utilPct.toFixed(1)} %`,
    lltv: lltv === null ? '—' : `${Number(lltv / 10n ** 14n) / 100} %`,
    lastUpdate: fmtAge(nowSec - s.marketLastUpdate),
  };
}

export interface RiskParam { label: string; value: string; note: string }

const RISK_LABELS = ['REGIME', 'FEED AGE', 'ENGINE H(L)', 'MARKET CAP', 'σ GAP', 'K TAIL', 'H FLOOR / MAX', 'SCHEDULED EVENT'] as const;

export function riskParams(s: Snapshot | null, nowSec: number): RiskParam[] {
  if (!s) return RISK_LABELS.map((label) => ({ label, value: '—', note: '' }));
  const sf = s.surface;
  return [
    { label: 'REGIME', value: regimeName(s.regime), note: s.regime !== s.calRegime ? `calendar: ${regimeName(s.calRegime)}` : 'calendar-derived' },
    { label: 'FEED AGE', value: fmtAge(nowSec - s.feedUpdatedAt).replace(/ ago$/, ''), note: `stale after ${fmtDuration(s.marketStaleSeconds)} while open` },
    { label: 'ENGINE H(L)', value: fmtBps(s.engineHaircutBps), note: `ramp target ${fmtBps(s.engineTargetBps)} · L = ${hours(s.closureLen)}` },
    { label: 'MARKET CAP', value: fmtBps(s.capBps), note: `in force now ${fmtBps(s.haircutNowBps)}` },
    { label: 'σ GAP', value: (Number(sf.sigmaGapWad) / 1e18).toFixed(4), note: 'gap volatility per √(overnight)' },
    { label: 'K TAIL', value: (sf.kTailBps / 10_000).toFixed(2), note: 'tail multiplier k' },
    { label: 'H FLOOR / MAX', value: `${fmtBps(sf.hFloorBps)} / ${fmtBps(sf.hMaxBps)}`, note: `surface set ${fmtAge(nowSec - sf.updatedAt)}` },
    { label: 'SCHEDULED EVENT', value: s.eventActive ? 'ACTIVE' : 'NONE', note: 'earnings or corporate action window' },
  ];
}
