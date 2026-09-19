import { describe, expect, it } from 'vitest';
import { client } from '../src/chain/client';
import { readCurve } from '../src/chain/curve';
import { readSnapshot } from '../src/chain/snapshot';

const enabled = process.env.VIGIL_NETWORK_TESTS === '1';

describe.skipIf(!enabled)('parity with the Foundry fixture (live testnet)', () => {
  it('closureHaircutBps on-chain equals test/unit/CurveFixture.t.sol', async () => {
    const snap = await readSnapshot(client);
    const curve = await readCurve(client, snap.surface);
    const at = (L: number) => curve.find((p) => p.L === L)?.bps;
    expect(at(0)).toBe(50);
    expect(at(86400)).toBe(611);
    expect(at(432000)).toBe(1304);
    expect(snap.capBps).toBe(500);
    expect(snap.surface.hFloorBps).toBe(50);
  }, 30_000);
});
