import type { PublicClient } from 'viem';
import { ADDR, MARKET_ID, MULTICALL3 } from '../deployment';
import { multicall3Abi } from '../abi/multicall3';
import { vigilSessionOracleAbi } from '../abi/vigilSessionOracle';
import { vigilRiskEngineAbi } from '../abi/vigilRiskEngine';
import { vigilOracleAbi } from '../abi/vigilOracle';
import { vigilBackstopAbi } from '../abi/vigilBackstop';
import { morphoAbi } from '../abi/morpho';
import { mockFeedAbi } from '../abi/mockFeed';

export type Regime = 0 | 1 | 2 | 3 | 4;

export interface Surface {
  sigmaGapWad: bigint; kTailBps: number; hFloorBps: number; hMaxBps: number; updatedAt: number;
}

export interface Snapshot {
  fetchedAtMs: number; chainTime: number;
  regime: Regime; calRegime: Regime; closeAt: number; nextOpen: number; inClosure: boolean; lastOpen: number; tightSince: number; closureLen: number;
  feedUsable: boolean; feedAnswer: bigint; feedUpdatedAt: number; marketStaleSeconds: number;
  price: bigint | null; priceError: string | null; unhaircutPrice: bigint | null;
  haircutNowBps: number; engineHaircutBps: number; engineTargetBps: number; capBps: number;
  surface: Surface; eventActive: boolean;
  premiumIndex: bigint; lastPoke: number; refRatePerSecond: bigint;
  backstopAssets: bigint; backstopShares: bigint; coverageCap: bigint; totalCovered: bigint; cooldown: number;
  supplyAssets: bigint; borrowAssets: bigint; marketLastUpdate: number;
}

export type MulticallResult = { status: 'success'; result: unknown } | { status: 'failure'; error: Error };

const asset = () => ADDR.StockToken ?? ADDR.MockStockToken;

/** Order is the contract between coreCalls() and decodeCore(). Keep both in sync. */
export const CORE_ORDER = [
  'blockTimestamp', 'regimeOf', 'closureOf', 'feedIsUsable', 'premiumIndex', 'lastPokeOf', 'configs',
  'haircutBps', 'targetHaircutBps', 'surfaces', 'eventActive',
  'price', 'unhaircutPrice', 'currentHaircutBps', 'MARKET_HAIRCUT_CAP_BPS',
  'totalAssets', 'totalSupply', 'coverageCapOf', 'totalCovered', 'COOLDOWN',
  'market', 'latestRoundData',
] as const;

export function coreCalls() {
  const so = { address: ADDR.VigilSessionOracle, abi: vigilSessionOracleAbi } as const;
  const risk = { address: ADDR.VigilRiskEngine, abi: vigilRiskEngineAbi } as const;
  const oracle = { address: ADDR.VigilOracle, abi: vigilOracleAbi } as const;
  const backstop = { address: ADDR.VigilBackstop, abi: vigilBackstopAbi } as const;
  const a = asset();
  // eventActive(asset, ts): the local clock is within seconds of block time on Nitro chains.
  const now = BigInt(Math.floor(Date.now() / 1000));
  return [
    { address: MULTICALL3, abi: multicall3Abi, functionName: 'getCurrentBlockTimestamp' },
    { ...so, functionName: 'regimeOf', args: [a] },
    { ...so, functionName: 'closureOf', args: [a] },
    { ...so, functionName: 'feedIsUsable', args: [a] },
    { ...so, functionName: 'premiumIndex', args: [a] },
    { ...so, functionName: 'lastPokeOf', args: [a] },
    { ...so, functionName: 'configs', args: [a] },
    { ...risk, functionName: 'haircutBps', args: [a] },
    { ...risk, functionName: 'targetHaircutBps', args: [a] },
    { ...risk, functionName: 'surfaces', args: [a] },
    { ...risk, functionName: 'eventActive', args: [a, now] },
    { ...oracle, functionName: 'price' },
    { ...oracle, functionName: 'unhaircutPrice' },
    { ...oracle, functionName: 'currentHaircutBps' },
    { ...oracle, functionName: 'MARKET_HAIRCUT_CAP_BPS' },
    { ...backstop, functionName: 'totalAssets' },
    { ...backstop, functionName: 'totalSupply' },
    { ...backstop, functionName: 'coverageCapOf', args: [MARKET_ID] },
    { ...backstop, functionName: 'totalCovered' },
    { ...backstop, functionName: 'COOLDOWN' },
    { address: ADDR.Morpho, abi: morphoAbi, functionName: 'market', args: [MARKET_ID] },
    { address: ADDR.MockFeed, abi: mockFeedAbi, functionName: 'latestRoundData' },
  ] as const;
}

export function rateCall(regime: Regime, closureLen: number) {
  return {
    address: ADDR.VigilRiskEngine, abi: vigilRiskEngineAbi, functionName: 'premiumRefRatePerSecond',
    args: [asset(), regime, BigInt(closureLen)],
  } as const;
}

const OPTIONAL = new Set<(typeof CORE_ORDER)[number]>(['price', 'unhaircutPrice']);

function pick(results: MulticallResult[], name: (typeof CORE_ORDER)[number]): unknown {
  const i = CORE_ORDER.indexOf(name);
  const r = results[i];
  if (!r) throw new Error(`missing result for ${name}`);
  if (r.status === 'failure') {
    if (OPTIONAL.has(name)) return null;
    throw new Error(`${name} failed: ${r.error.message}`);
  }
  return r.result;
}

const n = (x: unknown) => Number(x as bigint | number);
const b = (x: unknown) => BigInt(x as bigint | number);

export function decodeCore(results: MulticallResult[], fetchedAtMs: number): Omit<Snapshot, 'refRatePerSecond'> {
  const regimeOf = pick(results, 'regimeOf') as [number, number, bigint, bigint];
  const closureOf = pick(results, 'closureOf') as [bigint, bigint, boolean, bigint, bigint, bigint];
  const configs = pick(results, 'configs') as [string, bigint, number, bigint, bigint, number, boolean];
  const surf = pick(results, 'surfaces') as [bigint, number, number, number, bigint];
  const market = pick(results, 'market') as [bigint, bigint, bigint, bigint, bigint, bigint];
  const round = pick(results, 'latestRoundData') as [bigint, bigint, bigint, bigint, bigint];
  const priceRaw = results[CORE_ORDER.indexOf('price')]!;
  const unhaircutRaw = results[CORE_ORDER.indexOf('unhaircutPrice')]!;
  const closeAt = n(closureOf[0]);
  const nextOpen = n(closureOf[1]);
  return {
    fetchedAtMs,
    chainTime: n(pick(results, 'blockTimestamp')),
    regime: regimeOf[0] as Regime,
    calRegime: regimeOf[1] as Regime,
    closeAt, nextOpen,
    inClosure: closureOf[2],
    lastOpen: n(closureOf[3]),
    tightSince: n(closureOf[5]),
    closureLen: Math.max(0, nextOpen - closeAt),
    feedUsable: pick(results, 'feedIsUsable') as boolean,
    feedAnswer: b(round[1]),
    feedUpdatedAt: n(round[3]),
    marketStaleSeconds: n(configs[1]),
    price: priceRaw.status === 'success' ? b(priceRaw.result) : null,
    priceError: priceRaw.status === 'failure' ? priceRaw.error.message : null,
    unhaircutPrice: unhaircutRaw.status === 'success' ? b(unhaircutRaw.result) : null,
    haircutNowBps: n(pick(results, 'currentHaircutBps')),
    engineHaircutBps: n(pick(results, 'haircutBps')),
    engineTargetBps: n(pick(results, 'targetHaircutBps')),
    capBps: n(pick(results, 'MARKET_HAIRCUT_CAP_BPS')),
    surface: { sigmaGapWad: b(surf[0]), kTailBps: n(surf[1]), hFloorBps: n(surf[2]), hMaxBps: n(surf[3]), updatedAt: n(surf[4]) },
    eventActive: pick(results, 'eventActive') as boolean,
    premiumIndex: b(pick(results, 'premiumIndex')),
    lastPoke: n(pick(results, 'lastPokeOf')),
    backstopAssets: b(pick(results, 'totalAssets')),
    backstopShares: b(pick(results, 'totalSupply')),
    coverageCap: b(pick(results, 'coverageCapOf')),
    totalCovered: b(pick(results, 'totalCovered')),
    cooldown: n(pick(results, 'COOLDOWN')),
    supplyAssets: b(market[0]),
    borrowAssets: b(market[2]),
    marketLastUpdate: n(market[4]),
  };
}

export async function readSnapshot(client: PublicClient): Promise<Snapshot> {
  const fetchedAtMs = Date.now();
  const core = (await client.multicall({ contracts: coreCalls() as never, allowFailure: true })) as MulticallResult[];
  const base = decodeCore(core, fetchedAtMs);
  const regimeForRate = (base.regime === 0 ? 3 : base.regime) as Regime; // MARKET has no premium; show the closed-regime rate
  const [rate] = (await client.multicall({ contracts: [rateCall(regimeForRate, base.closureLen)] as never, allowFailure: true })) as MulticallResult[];
  const refRatePerSecond = rate && rate.status === 'success' ? BigInt(rate.result as bigint) : 0n;
  return { ...base, refRatePerSecond };
}
