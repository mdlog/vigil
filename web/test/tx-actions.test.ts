import { describe, expect, it } from 'vitest';
import type { PublicClient, WalletClient } from 'viem';
import type { AccountState, MarketParams } from '../src/chain/account';
import { ADDR, MARKET_ID } from '../src/deployment';
import {
  USDG, isMarketId, join, migrate, migratePrecheck, repay, requestWithdraw, supply, topUp, validateAmount, withdraw, type Legacy, type Step, type TxContext,
} from '../src/tx/actions';

const ME = '0x00000000000000000000000000000000000000aa' as const;
const PARAMS: MarketParams = { loanToken: ADDR.USDG, collateralToken: ADDR.StockToken, oracle: ADDR.VigilOracle, irm: ADDR.MockIRM, lltv: 860_000_000_000_000_000n };

/** A client and a wallet that record what the page would simulate and send; reads answer from `reads`. */
function harness(reads: Record<string, unknown> = {}) {
  const sims: { address: string; functionName: string; args: readonly unknown[] }[] = [];
  const signed: unknown[] = [];
  const said: string[] = [];
  const client = {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (!(functionName in reads)) throw new Error(`unexpected read ${functionName}`);
      return reads[functionName];
    },
    simulateContract: async (w: { address: string; functionName: string; args: readonly unknown[] }) => {
      sims.push({ address: w.address, functionName: w.functionName, args: w.args });
      return { request: w };
    },
  } as unknown as PublicClient;
  const wallet = {
    writeContract: async () => `0x${'ab'.repeat(32)}`,
    signTypedData: async (td: unknown) => { signed.push(td); return `0x${'11'.repeat(32)}${'22'.repeat(32)}1b`; },
  } as unknown as WalletClient;
  const ctx: TxContext = { client, wallet, account: ME, params: PARAMS, say: (t) => { said.push(t); } };
  return { ctx, sims, signed, said };
}
const run = async (steps: Step[]) => { for (const s of steps) await s.send(); };
const acct = (over: Partial<AccountState>): AccountState => ({
  address: ME, eth: 0n, usdg: 0n, stock: 0n, supplyShares: 0n, supplied: 0n, borrowShares: 0n, debt: 0n, collateral: 0n,
  totalSupplyAssets: 0n, totalSupplyShares: 0n, totalBorrowAssets: 0n, totalBorrowShares: 0n,
  authorized: false, member: false, delinquent: false, escrow: 0n, owed: 0n, paid: 0n, minReserve: 0n, vgShares: 0n, vgAssets: 0n, vgDecimals: 12, ...over,
});

describe('approvals', () => {
  it('supply without an approval when the allowance covers it', async () => {
    const h = harness({ allowance: 10n ** 30n });
    const steps = await supply(h.ctx, 10_000_000n);
    expect(steps.map((s) => s.label)).toEqual(['Supply 10.00 USDG']);
    await run(steps);
    expect(h.sims).toEqual([{ address: ADDR.Morpho, functionName: 'supply', args: [PARAMS, 10_000_000n, 0n, ME, '0x'] }]);
  });
  it('prepends the approval when the allowance is short', async () => {
    const h = harness({ allowance: 0n });
    const steps = await topUp(h.ctx, 500_000n);
    expect(steps.map((s) => s.label)).toEqual(['Approve USDG for the premium escrow', 'Top up escrow by 0.50 USDG']);
    await run(steps);
    expect(h.sims[0]).toEqual({ address: USDG, functionName: 'approve', args: [ADDR.VigilPremium, 500_000n] });
    expect(h.sims[1]).toEqual({ address: ADDR.VigilPremium, functionName: 'topUp', args: [MARKET_ID, ME, 500_000n] });
  });
});

describe('closing a position exactly', () => {
  it('withdraws everything by shares, a part by assets', async () => {
    const a = acct({ supplied: 35_000_000n, supplyShares: 35_000_000_000_000n });
    const h = harness();
    await run(await withdraw(h.ctx, a, 35_000_000n));
    await run(await withdraw(h.ctx, a, 1_000_000n));
    expect(h.sims.map((s) => s.args)).toEqual([[PARAMS, 0n, 35_000_000_000_000n, ME, ME], [PARAMS, 1_000_000n, 0n, ME, ME]]);
  });
  it('repays the whole debt by shares', async () => {
    const h = harness({ allowance: 10n ** 30n });
    await run(await repay(h.ctx, acct({ debt: 44_590_000n, borrowShares: 44_590_000_000_000n }), 44_590_000n));
    expect(h.sims[0]).toEqual({ address: ADDR.Morpho, functionName: 'repay', args: [PARAMS, 0n, 44_590_000_000_000n, ME, '0x'] });
  });
  it('repaying everything approves headroom for interest accrued since the market was last touched', async () => {
    // the page reads Morpho's stored totals; repaying by shares pulls the debt *with* the interest accrued since then
    const h = harness({ allowance: 44_590_000n }); // exactly the stale debt — what the old page approved, and what failed
    const steps = await repay(h.ctx, acct({ debt: 44_590_000n, borrowShares: 44_590_000_000_000n }), 44_590_000n);
    expect(steps.map((s) => s.label)).toEqual(['Approve USDG for Morpho', 'Repay 44.59 USDG']);
    await run(steps);
    expect(h.sims[0]).toEqual({ address: USDG, functionName: 'approve', args: [ADDR.Morpho, 45_035_901n] });
  });
  it('a partial repay approves exactly what it repays', async () => {
    const h = harness({ allowance: 0n });
    await run(await repay(h.ctx, acct({ debt: 44_590_000n, borrowShares: 44_590_000_000_000n }), 10_000_000n));
    expect(h.sims[0]).toEqual({ address: USDG, functionName: 'approve', args: [ADDR.Morpho, 10_000_000n] });
    expect(h.sims[1]!.args).toEqual([PARAMS, 10_000_000n, 0n, ME, '0x']);
  });
  it('requests all shares for the whole deposit, previewWithdraw otherwise', async () => {
    const a = acct({ vgAssets: 10_000_000n, vgShares: 10_000_000_000_000n });
    const all = harness();
    const s1 = await requestWithdraw(all.ctx, a, 10_000_000n);
    expect(s1[0]!.label).toBe('Request withdrawal of 10.00 USDG (10 shares)');
    await run(s1);
    expect(all.sims[0]!.args).toEqual([10_000_000_000_000n]);
    const part = harness({ previewWithdraw: 4_000_000_000_001n });
    const s2 = await requestWithdraw(part.ctx, a, 4_000_000n);
    expect(s2[0]!.label).toBe('Request withdrawal of 4.00 USDG (4.000000000001 shares)');
  });
  it('joins by authorising VigilPreLiquidation', async () => {
    const h = harness();
    await run(await join(h.ctx));
    expect(h.sims[0]).toEqual({ address: ADDR.Morpho, functionName: 'setAuthorization', args: [ADDR.VigilPreLiquidation, true] });
  });
});

describe('migration', () => {
  const l: Legacy = { params: [USDG, ADDR.StockToken, ADDR.LegacyOracle, ADDR.MockIRM, 625_000_000_000_000_000n], shares: 20_000_000_000_000n, assets: 20_000_000n };
  const from = { loanToken: l.params[0], collateralToken: l.params[1], oracle: l.params[2], irm: l.params[3], lltv: l.params[4] };
  it('signs Morpho’s authorisation first when the migrator is not authorised', async () => {
    const h = harness({ isAuthorized: false, nonce: 3n });
    const steps = await migrate(h.ctx, `0x${'cd'.repeat(32)}`, l);
    expect(steps[0]!.label).toBe('Migrate 20.00 USDG from 0xcdcd…cdcd into the Vigil market');
    await run(steps);
    expect(h.said).toEqual(['Sign the Morpho authorisation in the wallet (a signature, no gas)…', 'Authorisation signed — now confirm the migration transaction…']);
    expect(h.signed).toHaveLength(1);
    const [f, to, shares, auth, sig] = h.sims[0]!.args as [unknown, unknown, bigint, { nonce: bigint; deadline: bigint; authorized: string }, { v: number; r: string; s: string }];
    expect(h.sims[0]!.functionName).toBe('migrate');
    expect([f, to, shares]).toEqual([from, PARAMS, 20_000_000_000_000n]);
    expect([auth.nonce, auth.authorized, auth.deadline > 0n]).toEqual([3n, ADDR.VigilMigrator, true]);
    expect(sig).toEqual({ v: 27, r: `0x${'11'.repeat(32)}`, s: `0x${'22'.repeat(32)}` });
  });
  it('skips the signature when already authorised', async () => {
    const h = harness({ isAuthorized: true });
    await run(await migrate(h.ctx, `0x${'cd'.repeat(32)}`, l));
    expect(h.signed).toHaveLength(0);
    const [, , , auth, sig] = h.sims[0]!.args as [unknown, unknown, bigint, { nonce: bigint; deadline: bigint }, { v: number; r: string }];
    expect([auth.nonce, auth.deadline, sig.v, sig.r]).toEqual([0n, 0n, 27, `0x${'0'.repeat(64)}`]);
  });
  it('explains why a migration cannot start', () => {
    expect(migratePrecheck(null)).toBe('No market with that id on this Morpho.');
    expect(migratePrecheck({ ...l, params: ['0x0000000000000000000000000000000000000002', ...l.params.slice(1)] as unknown as Legacy['params'] })).toBe('That market lends a different token.');
    expect(migratePrecheck({ ...l, shares: 0n })).toBe('You have no supply in that market.');
    expect(migratePrecheck(l)).toBeNull();
    expect(isMarketId(MARKET_ID)).toBe(true);
    expect(isMarketId('0x1234')).toBe(false);
  });
});

describe('amounts typed with a decimal comma', () => {
  it('reads a lone comma as the decimal point, the way Indonesian and most European keyboards type it', () => {
    expect(validateAmount('0,5', 6, null, 'USDG')).toEqual({ ok: true, value: 500_000n });
    expect(validateAmount('0,05', 6, null, 'USDG')).toEqual({ ok: true, value: 50_000n });
    expect(validateAmount('1,5', 6, null, 'USDG')).toEqual({ ok: true, value: 1_500_000n });
    expect(validateAmount('0,500', 6, null, 'USDG')).toEqual({ ok: true, value: 500_000n });
    expect(validateAmount('1.000,5', 6, null, 'USDG')).toEqual({ ok: true, value: 1_000_500_000n });
  });
  it('keeps a comma as a thousands separator only in three-digit groups', () => {
    expect(validateAmount('1,000', 6, null, 'USDG')).toEqual({ ok: true, value: 1_000_000_000n });
    expect(validateAmount('12,345.5', 6, null, 'USDG')).toEqual({ ok: true, value: 12_345_500_000n });
  });
  it('refuses a number that cannot be read one way only', () => {
    const bad = { ok: false, error: 'Enter a positive USDG amount with at most 6 decimals.' };
    expect(validateAmount('1,2,3', 6, null, 'USDG')).toEqual(bad);
    expect(validateAmount('1,000,5', 6, null, 'USDG')).toEqual(bad);
  });
});

describe('validateAmount', () => {
  it('accepts a positive amount within the decimals and the limit', () => {
    expect(validateAmount('3.5', 6, 4_000_000n, 'USDG')).toEqual({ ok: true, value: 3_500_000n });
    expect(validateAmount('1,000', 6, null, 'USDG')).toEqual({ ok: true, value: 1_000_000_000n });
  });
  it('explains empty, zero, malformed and over-precise input', () => {
    const bad = { ok: false, error: 'Enter a positive USDG amount with at most 6 decimals.' };
    for (const s of ['', '0', '-1', 'abc', '1.1234567']) expect(validateAmount(s, 6, null, 'USDG')).toEqual(bad);
  });
  it('explains an amount above the limit', () => {
    expect(validateAmount('5', 6, 4_000_000n, 'USDG')).toEqual({ ok: false, error: 'That is more than the 4 USDG available.' });
    expect(validateAmount('5', 6, 0n, 'USDG')).toEqual({ ok: false, error: 'That is more than the 0 USDG available.' });
  });
});
