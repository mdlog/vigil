/** Connection state and the landing page's live card, as pure functions of the last snapshot. */
import type { Snapshot } from '../chain/snapshot';
import { fmtBps, fmtUsd, priceToUsdg } from '../ui/format';
import { isStale } from '../ui/poll';
import { REGIME_NAMES } from '../ui/time';

export type SyncStatus = 'connecting' | 'live' | 'stale' | 'offline';

/** connecting → live ⇄ stale (> 60 s since the last good read); offline when the very first read failed. */
export function syncStatus(hasSnapshot: boolean, lastOkMs: number | null, error: string | null, nowMs: number): SyncStatus {
  if (!hasSnapshot || lastOkMs === null) return error !== null ? 'offline' : 'connecting';
  return isStale(lastOkMs, nowMs) ? 'stale' : 'live';
}

export interface HeroView { symbol: string; pair: string; live: boolean; pill: string; price: string; haircut: string; regime: string; footer: string }

export function heroView(s: Snapshot | null, status: SyncStatus, symbol: string): HeroView {
  const pair = `${symbol} / USDG`;
  const none = { symbol, pair, live: false, price: '—', haircut: '—', regime: '—' };
  if (status === 'offline' || status === 'stale') return { ...none, pill: 'TESTNET OFFLINE', footer: 'RPC UNREACHABLE' };
  if (s === null || status === 'connecting') return { ...none, pill: 'CONNECTING', footer: 'CONNECTING TO TESTNET' };
  const regime = REGIME_NAMES[s.regime] ?? String(s.regime);
  if (s.price === null) return { ...none, regime, pill: 'ORACLE PAUSED', footer: 'TESTNET LIVE · ORACLE PAUSED' };
  return {
    symbol, pair, live: true, pill: 'LIVE TESTNET',
    price: fmtUsd(priceToUsdg(s.price)),
    haircut: `−${fmtBps(s.haircutNowBps)}`,
    regime,
    footer: s.feedUsable ? 'TESTNET LIVE · FEED USABLE' : 'TESTNET LIVE · FEED NOT USABLE',
  };
}
