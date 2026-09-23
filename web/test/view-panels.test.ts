import { describe, expect, it } from 'vitest';
import { ContractFunctionExecutionError, ContractFunctionRevertedError, encodeErrorResult, parseAbi, type Abi, type Hex } from 'viem';
import { vigilOracleAbi } from '../src/abi/vigilOracle';
import { economyView, marketView, oracleView, riskParams, sessionView } from '../src/view/panels';
import { T0, snap } from './fixtures';

describe('sessionView', () => {
  it('counts down to Monday 09:30 ET during the weekend closure', () => {
    const v = sessionView(snap(), T0 * 1000);
    expect(v.regime).toBe('CLOSED');
    expect(v.headline).toBe('Market is closed.');
    expect(v.note).toBe('closed — derived on-chain from the NYSE calendar');
    expect(v.nextLabel).toBe('Opens in');
    expect(v.countdown).toBe('1d 21h 30m');
    expect(v.nextAt).toBe('Mon Sep 28, 09:30 ET');
    expect(v.progressPct).toBeCloseTo((72000 / 235800) * 100, 6);
    expect(v.closureHours).toBe('65.5 h');
    expect(v.feedNote).toBe('last update 20.1 h ago — frozen while closed is the expected state');
  });
  it('names the tightening when the effective regime differs from the calendar', () => {
    expect(sessionView(snap({ calRegime: 0, tightSince: T0 - 60 }), T0 * 1000).note).toBe('calendar says MARKET — tightened by a keeper attestation');
    expect(sessionView(snap({ calRegime: 0, tightSince: 0 }), T0 * 1000).note).toBe('calendar says MARKET — tightened by feed freshness');
  });
  it('counts down to the close while the market is open', () => {
    const open = snap({ regime: 0, calRegime: 0, closeAt: T0 + 3600, lastOpen: T0 - 3600 });
    const v = sessionView(open, T0 * 1000);
    expect([v.nextLabel, v.countdown, v.headline]).toEqual(['Closes in', '1h 00m 00s', 'Market is open.']);
    expect(v.progressPct).toBeCloseTo(50, 6);
  });
});

describe('oracleView', () => {
  it('shows the haircut price as a formula over the raw feed', () => {
    expect(oracleView(snap())).toEqual({
      price: '346.06', formula: '= 364.27 × (1 − 5.00 %)', feed: '364.27', haircut: '5.00 %',
      note: 'engine H(L) 10.70 % for L = 65.5 h, capped at 5.00 % for the market', reverting: false,
    });
    expect(oracleView(snap({ eventActive: true })).note).toMatch(/ · scheduled event active$/);
  });
  it('shows "reverting" and why when price() reverts', () => {
    const v = oracleView(snap({ price: null, priceError: viemRevert(encodeErrorResult({ abi: vigilOracleAbi, errorName: 'VigilStale' })) }));
    expect([v.price, v.formula, v.reverting]).toEqual(['reverting', 'price() reverts: VigilStale()', true]);
    expect(oracleView(snap({ price: null, priceError: null })).formula).toBe('the oracle refuses to price (corporate action or unexpectedly stale feed)');
  });
  it('shows a require() string and an undecodable selector too', () => {
    const plain = parseAbi(['function price() view returns (uint256)']);
    const reason = encodeErrorResult({ abi: parseAbi(['error Error(string)']), errorName: 'Error', args: ['feed paused'] });
    expect(oracleView(snap({ price: null, priceError: viemRevert(reason, plain) })).formula).toBe('price() reverts: feed paused');
    expect(oracleView(snap({ price: null, priceError: viemRevert('0xdeadbeef') })).formula).toBe('price() reverts: 0xdeadbeef');
  });
});

/** The message viem puts on a reverted multicall entry — made by viem's own error classes, never typed by hand. */
function viemRevert(data: Hex, abi: Abi = vigilOracleAbi): string {
  const cause = new ContractFunctionRevertedError({ abi, data, functionName: 'price' });
  return new ContractFunctionExecutionError(cause, { abi, functionName: 'price', contractAddress: '0x79DA01DB22808E3A7397B788F171a7647b1bEf8f' }).message;
}

describe('economyView', () => {
  it('prices the premium index, this closure and the backstop', () => {
    expect(economyView(snap(), T0)).toEqual({
      premiumIndex: '0.0293 USDG',
      premiumIndexNote: 'per 1,000 USDG borrowed, accrued since deployment (∫ π_ref dt) · last persisted 60.0 min ago',
      closurePremium: '0.349 USDG',
      closurePremiumNote: 'per 1,000 USDG borrowed at the reference buffer · CLOSED rate over L = 65.5 h (2d 17h 30m)',
      backstop: '55 USDG',
      backstopNote: 'coverage cap 100,000 USDG · covered so far 0.24 · exit cooldown 7d 0h 00m',
    });
  });
});

describe('marketView', () => {
  it('reports supply, borrow, utilisation and the LLTV', () => {
    expect(marketView(snap({ borrowAssets: 35_000_000n }), T0, 860_000_000_000_000_000n)).toEqual({
      supplied: '140', borrowed: '35', utilPct: 25, util: '25.0 %', lltv: '86 %', lastUpdate: '2.0 h ago',
    });
    expect(marketView(snap({ supplyAssets: 0n }), T0, null)).toMatchObject({ utilPct: 0, util: '0.0 %', lltv: '—' });
  });
});

describe('riskParams', () => {
  it('lists eight on-chain parameters', () => {
    const p = riskParams(snap(), T0);
    expect(p.map((x) => x.label)).toEqual(['REGIME', 'FEED AGE', 'ENGINE H(L)', 'MARKET CAP', 'σ GAP', 'K TAIL', 'H FLOOR / MAX', 'SCHEDULED EVENT']);
    expect(p[2]).toEqual({ label: 'ENGINE H(L)', value: '10.70 %', note: 'ramp target 10.70 % · L = 65.5 h' });
    expect(p[4]!.value).toBe('0.0176');
    expect(p[6]!.value).toBe('1.00 % / 25.00 %');
  });
  it('keeps the labels and shows dashes before the first read', () => {
    const p = riskParams(null, T0);
    expect(p).toHaveLength(8);
    expect(p.every((x) => x.value === '—')).toBe(true);
  });
});
