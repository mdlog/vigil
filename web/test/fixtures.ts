import type { Snapshot } from '../src/chain/snapshot';

const at = (d: number, h: number, m = 0) => Date.UTC(2026, 8, d, h, m, 0) / 1000;
/** Saturday 26 Sep 2026, 12:00 ET (16:00 UTC) — inside the weekend closure. */
export const T0 = at(26, 16);

/** A CLOSED-weekend snapshot of the v4 market (TSLA at 364.27, 5 % cap in force). */
export function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    fetchedAtMs: T0 * 1000, chainTime: T0,
    regime: 3, calRegime: 3,
    closeAt: at(25, 20), nextOpen: at(28, 13, 30), inClosure: true, lastOpen: at(25, 13, 30), tightSince: 0, closureLen: 235800,
    feedUsable: true, feedAnswer: 36427000000n, feedUpdatedAt: at(25, 19, 55), marketStaleSeconds: 3600,
    price: 34606n * 10n ** 22n, priceError: null, unhaircutPrice: 36427n * 10n ** 22n,
    haircutNowBps: 500, engineHaircutBps: 1070, engineTargetBps: 1070, capBps: 500,
    surface: { sigmaGapWad: 17_600_000_000_000_000n, kTailBps: 30000, hFloorBps: 100, hMaxBps: 2500, updatedAt: at(19, 22, 52) },
    eventActive: false,
    premiumIndex: 29_300_000_000_000n, lastPoke: T0 - 3600, refRatePerSecond: 1_480_000_000n,
    backstopAssets: 54_760_000n, backstopShares: 54_760_000_000_000n, coverageCap: 100_000_000_000n, totalCovered: 240_000n, cooldown: 604800,
    supplyAssets: 140_000_000n, borrowAssets: 0n, marketLastUpdate: T0 - 7200,
    ...over,
  };
}
