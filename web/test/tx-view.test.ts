import { describe, expect, it } from 'vitest';
import type { AccountState, WithdrawRequest } from '../src/chain/account';
import {
  BORROW_HINT, backstopTiles, balancesLine, borrowPreview, borrowTiles, describeLegacy, fieldLimits, freeEscrow, lendTile, memberTiles, requestStatus, walletChip, walletReady,
} from '../src/tx/view';

const LLTV = 860_000_000_000_000_000n;
const P = 346n * 10n ** 24n; // 346 USDG per TSLA at Morpho's 1e24 scale
const USDG = '0x7E955252E15c84f5768B83c41a71F9eba181802F';

function acct(over: Partial<AccountState> = {}): AccountState {
  return {
    address: '0x00000000000000000000000000000000000000aa', eth: 10n ** 16n, usdg: 100_000_000n, stock: 5n * 10n ** 18n,
    supplyShares: 0n, supplied: 0n, borrowShares: 0n, debt: 0n, collateral: 0n,
    totalSupplyAssets: 140_000_000n, totalSupplyShares: 140_000_000_000_000n, totalBorrowAssets: 0n, totalBorrowShares: 0n,
    authorized: false, member: false, delinquent: false, escrow: 0n, owed: 0n, paid: 0n, minReserve: 0n,
    vgShares: 0n, vgAssets: 0n, vgDecimals: 12,
    ...over,
  };
}

describe('limits and max buttons', () => {
  it('borrow is bounded by the room at the oracle price; no max without a price', () => {
    const a = acct({ collateral: 15n * 10n ** 16n }); // 0.15 TSLA ≈ 51.90 USDG → 44.634 borrowable at 86 %
    expect(fieldLimits(a, P, LLTV).borrow).toEqual({ limit: 44_634_000n, button: 44_634_000n });
    expect(fieldLimits(a, null, LLTV).borrow).toEqual({ limit: null, button: null });
    expect(fieldLimits(acct({ collateral: 15n * 10n ** 16n, debt: 50_000_000n }), P, LLTV).borrow).toEqual({ limit: 0n, button: null });
  });
  it('repay max is the smaller of debt and wallet; collateral only leaves with zero debt', () => {
    expect(fieldLimits(acct({ debt: 30_000_000n, usdg: 20_000_000n }), P, LLTV).repay).toEqual({ limit: 30_000_000n, button: 20_000_000n });
    expect(fieldLimits(acct({ debt: 0n }), P, LLTV).repay.button).toBeNull();
    expect(fieldLimits(acct({ debt: 1n, collateral: 7n }), P, LLTV).withdrawCollateral).toEqual({ limit: 7n, button: null });
    expect(fieldLimits(acct({ collateral: 7n }), P, LLTV).withdrawCollateral).toEqual({ limit: 7n, button: 7n });
  });
  it('escrow above the reserve is free only while nothing is owed', () => {
    expect(freeEscrow({ owed: 1n, debt: 0n, escrow: 10n, minReserve: 0n })).toBe(0n);
    expect(freeEscrow({ owed: 0n, debt: 5n, escrow: 10n, minReserve: 4n })).toBe(6n);
    expect(freeEscrow({ owed: 0n, debt: 5n, escrow: 3n, minReserve: 4n })).toBe(0n);
    expect(freeEscrow({ owed: 0n, debt: 0n, escrow: 10n, minReserve: 4n })).toBe(10n);
  });
});

describe('tiles', () => {
  it('balances and supply share', () => {
    expect(balancesLine(acct(), 'TSLA')).toBe('0.0100 ETH · 100.00 USDG · 5 TSLA');
    expect(lendTile(null)).toEqual({ value: '—', note: '' });
    expect(lendTile(acct({ supplied: 35_000_000n }))).toEqual({ value: '35.00 USDG', note: '25.00 % of 140 USDG supplied · 140 USDG idle' });
  });
  it('borrow tiles at the oracle price', () => {
    const t = borrowTiles(acct({ collateral: 15n * 10n ** 16n, debt: 44_590_000n }), { price: P, haircutNowBps: 500 }, LLTV, 'TSLA');
    expect(t.ltvLabel).toBe('LTV · LLTV 86 %');
    expect(t.collateral).toEqual({ value: '0.15 TSLA', note: '≈ 51.90 USDG at the oracle price' });
    expect(t.ltv).toEqual({ value: '85.91 %', warn: true, note: 'above the 76 % unwind target' });
    expect(t.room).toEqual({ value: '0.04 USDG', note: 'at 346.00 USDG per TSLA (haircut 5.00 % in force)' });
  });
  it('borrow tiles while the oracle reverts', () => {
    const t = borrowTiles(acct({ collateral: 15n * 10n ** 16n }), { price: null, haircutNowBps: 500 }, LLTV, 'TSLA');
    expect(t.collateral.note).toBe('oracle not pricing');
    expect(t.ltv.value).toBe('—');
    expect(t.room).toEqual({ value: '—', note: 'the oracle reverts — borrows and liquidations are paused' });
  });
  it('membership states', () => {
    expect(memberTiles(acct({ member: true, authorized: true })).membership.value).toBe('Member');
    const d = memberTiles(acct({ authorized: true, delinquent: true, minReserve: 70_000n }));
    expect([d.membership.value, d.membership.warn]).toEqual(['Delinquent', true]);
    expect(d.membership.note).toBe('escrow below what is owed plus the 7-day reserve (0.07 USDG) — top up to restore cover');
    expect(memberTiles(acct()).membership.value).toBe('Not a member');
    expect(memberTiles(acct()).joinNote).toMatch(/^Lets VigilPreLiquidation repay part of your debt/);
    expect(memberTiles(acct({ authorized: true })).joinNote).toMatch(/^Revoking ends membership/);
  });
  it('backstop tiles', () => {
    const t = backstopTiles(acct({ vgShares: 10n * 10n ** 12n, vgAssets: 10_000_000n }), { backstopAssets: 54_760_000n, coverageCap: 100_000_000_000n, totalCovered: 240_000n });
    expect(t.deposit).toEqual({ value: '10.00 USDG', note: '10 vgUSDG shares at the current share price' });
    expect(t.vault).toEqual({ value: '55 USDG', note: 'coverage cap 100,000 · covered so far 0.24' });
    expect(backstopTiles(null, null)).toEqual({ deposit: { value: '—', note: '' }, vault: { value: '—', note: '' } });
  });
});

describe('borrow preview', () => {
  const a = acct({ collateral: 15n * 10n ** 16n });
  it('explains the oracle until an amount is typed', () => {
    expect(borrowPreview('', a, P, LLTV)).toBe(BORROW_HINT);
    expect(borrowPreview('1', a, null, LLTV)).toBe(BORROW_HINT);
  });
  it('reads a decimal comma the way the amount field does', () => {
    expect(borrowPreview('0,5', a, P, LLTV)).toBe(borrowPreview('0.5', a, P, LLTV));
    expect(borrowPreview('0,5', a, P, LLTV)).toBe('LTV after: 0.96 % of 86.00 %.');
  });
  it('shows the LTV after, the unwind warning and the LLTV refusal', () => {
    expect(borrowPreview('1', a, P, LLTV)).toBe('LTV after: 1.92 % of 86.00 %.');
    expect(borrowPreview('44', a, P, LLTV)).toBe('LTV after: 84.77 % of 86.00 % — above the 76 % unwind target: a member would be unwound before the next close.');
    expect(borrowPreview('45', a, P, LLTV)).toBe('LTV after: 86.70 % — above the 86.00 % LLTV, Morpho would reject it.');
  });
});

describe('withdrawal requests', () => {
  const r = (over: Partial<WithdrawRequest> = {}): WithdrawRequest => ({ id: 1n, shares: 1n, assetsNow: 1n, readyAt: 1000, claimed: false, ...over });
  it('cooldown, ready outside MARKET, ready, claimed', () => {
    expect(requestStatus(r({ readyAt: 1000 + 3600 }), 1000, true)).toEqual({ text: 'cooldown 1h 00m 00s', claimable: false });
    expect(requestStatus(r(), 1000, false)).toEqual({ text: 'ready — claim during MARKET', claimable: false });
    expect(requestStatus(r(), 1000, true)).toEqual({ text: 'ready', claimable: true });
    expect(requestStatus(r({ claimed: true }), 1000, true)).toEqual({ text: 'claimed', claimable: false });
  });
});

describe('migration source', () => {
  const legacy = (loan: `0x${string}`) => ({
    params: [loan, '0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E', '0xabcdef0000000000000000000000000000001234', '0x0000000000000000000000000000000000000001', 625_000_000_000_000_000n] as const,
    shares: 1n, assets: 20_000_000n,
  });
  it('describes a USDG market and refuses another loan token', () => {
    expect(describeLegacy(legacy(USDG), USDG)).toBe('Your supply there: 20.00 USDG · LLTV 62.50 % · oracle 0xabcd…1234 (plain, no session awareness).');
    expect(describeLegacy(legacy('0x0000000000000000000000000000000000000002'), USDG)).toMatch(/^Different loan token — cannot migrate\. Your supply there/);
    expect(describeLegacy(null, USDG)).toBe('No market with that id on this Morpho.');
  });
});

describe('walletReady', () => {
  const ok = { address: '0x1' as `0x${string}`, account: acct(), params: { lltv: LLTV }, chainId: 46630, busy: false };
  it('only when connected, on the chain, read and idle', () => {
    expect(walletReady(ok, 46630)).toBe(true);
    expect(walletReady({ ...ok, chainId: 1 }, 46630)).toBe(false);
    expect(walletReady({ ...ok, busy: true }, 46630)).toBe(false);
    expect(walletReady({ ...ok, account: null }, 46630)).toBe(false);
    expect(walletReady({ ...ok, params: null }, 46630)).toBe(false);
    expect(walletReady({ ...ok, address: null }, 46630)).toBe(false);
  });
});

describe('walletChip (the header control)', () => {
  it('offers Connect, then Switch on a foreign chain, then shows the short address', () => {
    expect(walletChip(null, null, 46630, 'Robinhood Chain testnet')).toEqual({ kind: 'connect' });
    expect(walletChip('0x90351bB1E85a17D5f70c62C0cC076D39D897076D', 1, 46630, 'Robinhood Chain testnet')).toEqual({ kind: 'switch', label: 'Switch to Robinhood Chain testnet' });
    expect(walletChip('0x90351bB1E85a17D5f70c62C0cC076D39D897076D', 46630, 46630, 'Robinhood Chain testnet')).toEqual({ kind: 'connected', label: '0x9035…076D' });
  });
});
