import type { PublicClient } from 'viem';
import { ADDR } from '../deployment';
import { vigilRiskEngineAbi } from '../abi/vigilRiskEngine';
import type { MulticallResult, Surface } from './snapshot';

export interface CurvePoint { L: number; bps: number }

export const CURVE_STEP = 7200;
export const CURVE_MAX = 432000; // 120 h
export const CURVE_L: number[] = Array.from({ length: CURVE_MAX / CURVE_STEP + 1 }, (_, i) => i * CURVE_STEP);

export const MARKERS = [
  { L: 63000, label: 'overnight' },
  { L: 235800, label: 'weekend' },
  { L: 322200, label: 'long weekend' },
] as const;

export function curveCalls(surface: Surface, eventMultBps = 10000n) {
  const sf = {
    sigmaGapWad: surface.sigmaGapWad, kTailBps: surface.kTailBps, hFloorBps: surface.hFloorBps,
    hMaxBps: surface.hMaxBps, updatedAt: BigInt(surface.updatedAt),
  };
  return CURVE_L.map((L) => ({
    address: ADDR.VigilRiskEngine, abi: vigilRiskEngineAbi, functionName: 'closureHaircutBps' as const,
    args: [sf, BigInt(L), eventMultBps] as const,
  }));
}

export function decodeCurve(results: MulticallResult[]): CurvePoint[] {
  return CURVE_L.map((L, i) => {
    const r = results[i];
    if (!r || r.status !== 'success') throw new Error(`closureHaircutBps failed at L=${L}`);
    return { L, bps: Number(r.result as bigint) };
  });
}

export async function readCurve(client: PublicClient, surface: Surface): Promise<CurvePoint[]> {
  const res = (await client.multicall({ contracts: curveCalls(surface) as never, allowFailure: true })) as MulticallResult[];
  return decodeCurve(res);
}
