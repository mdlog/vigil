import { describe, expect, it } from 'vitest';
import { client } from '../src/chain/client';
import { readCurve } from '../src/chain/curve';
import { readSnapshot } from '../src/chain/snapshot';
import { MARKETS } from '../src/deployment';

const enabled = process.env.VIGIL_NETWORK_TESTS === '1';

/** σ_gap per ticker as script/DeployLib.sol VigilParams.surfaceFor sets it (sample night σ, calibrator/report.md). */
const SIGMA: Record<string, bigint> = {
  TSLA: 17_600_000_000_000_000n, AMD: 19_700_000_000_000_000n, AMZN: 12_200_000_000_000_000n,
  NFLX: 10_600_000_000_000_000n, PLTR: 18_700_000_000_000_000n,
};

describe.skipIf(!enabled)('parity with the Foundry fixture and the calibration (live testnet)', () => {
  it('closureHaircutBps on-chain equals test/unit/CurveFixture.t.sol for the NVDA surface', async () => {
    // closureHaircutBps is pure: the deployed bytecode is checked against the fixture whatever the live markets are
    const nvda = { sigmaGapWad: 16_000_000_000_000_000n, kTailBps: 30000, hFloorBps: 50, hMaxBps: 2500, updatedAt: 0 };
    const curve = await readCurve(client, nvda);
    const at = (L: number) => curve.find((p) => p.L === L)?.bps;
    expect(at(0)).toBe(50);
    expect(at(86400)).toBe(611);
    expect(at(432000)).toBe(1304);
  }, 30_000);

  it('every live market runs its calibrated surface under the 5 % market cap', async () => {
    for (const m of MARKETS) {
      const snap = await readSnapshot(client, m);
      expect(snap.surface.sigmaGapWad, m.symbol).toBe(SIGMA[m.symbol]);
      expect(snap.surface.kTailBps, m.symbol).toBe(30000);
      expect(snap.surface.hFloorBps, m.symbol).toBe(50);
      expect(snap.surface.hMaxBps, m.symbol).toBe(2500);
      expect(snap.capBps, m.symbol).toBe(500);
    }
  }, 60_000);
});
