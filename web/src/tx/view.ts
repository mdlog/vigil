/** What the "Use it" tab shows for one account — limits, tiles, previews — as pure functions of the chain reads
 *  (ported from paint() / previewBorrow() / updateRequests() in web/src/panels/use.ts @ 7f9d414). */
import { formatUnits } from 'viem';
import type { AccountState, MarketParams, WithdrawRequest } from '../chain/account';
import type { Snapshot } from '../chain/snapshot';
import { collateralValue, ltvBps, maxBorrowOf, parseAmount } from '../chain/math';
import { fmtBps, fmtDuration, fmtUsd, shortAddr } from '../ui/format';
import type { Legacy } from './actions';
import { DEFAULT_LLTV, lltvBpsOf, stk, usd } from './units';

export interface TileView { value: string; note: string; warn?: boolean }
const EMPTY: TileView = { value: '—', note: '' };

export const balancesLine = (a: AccountState, symbol: string) =>
  `${Number(formatUnits(a.eth, 18)).toFixed(4)} ETH · ${usd(a.usdg)} USDG · ${stk(a.stock)} ${symbol}`;

export type FieldKey = 'supply' | 'withdraw' | 'addCollateral' | 'borrow' | 'repay' | 'withdrawCollateral' | 'topUp' | 'withdrawUnused' | 'deposit' | 'request';
/** `limit`: what an entered amount is checked against. `button`: what the field's max button fills in (null hides it). */
export interface FieldLimit { limit: bigint | null; button: bigint | null }

/** Escrow a member may take back: nothing while a premium is owed; what is above the 7-day reserve while in debt. */
export function freeEscrow(a: Pick<AccountState, 'owed' | 'debt' | 'escrow' | 'minReserve'>): bigint {
  const free = a.owed > 0n ? 0n : a.debt > 0n ? a.escrow - a.minReserve : a.escrow;
  return free > 0n ? free : 0n;
}

/** Room left to borrow at the oracle price (negative above the LLTV), or null while the oracle does not price. */
export function borrowRoom(a: AccountState, price: bigint | null, lltv: bigint | null): bigint | null {
  return price === null ? null : maxBorrowOf(a.collateral, price, lltv ?? DEFAULT_LLTV) - a.debt;
}

export function fieldLimits(a: AccountState, price: bigint | null, lltv: bigint | null): Record<FieldKey, FieldLimit> {
  const room = borrowRoom(a, price, lltv);
  const free = freeEscrow(a);
  return {
    supply: { limit: a.usdg, button: a.usdg },
    withdraw: { limit: a.supplied, button: a.supplied },
    addCollateral: { limit: a.stock, button: a.stock },
    borrow: { limit: room === null ? null : room > 0n ? room : 0n, button: room !== null && room > 0n ? room : null },
    repay: { limit: a.debt, button: a.debt > 0n ? (a.debt < a.usdg ? a.debt : a.usdg) : null },
    withdrawCollateral: { limit: a.collateral, button: a.debt === 0n ? a.collateral : null },
    topUp: { limit: a.usdg, button: a.usdg },
    withdrawUnused: { limit: free, button: free > 0n ? free : null },
    deposit: { limit: a.usdg, button: a.usdg },
    request: { limit: a.vgAssets, button: a.vgAssets > 0n ? a.vgAssets : null },
  };
}

export function lendTile(a: AccountState | null): TileView {
  if (!a) return EMPTY;
  return {
    value: `${usd(a.supplied)} USDG`,
    note: a.totalSupplyAssets > 0n
      ? `${((Number(a.supplied) / Number(a.totalSupplyAssets)) * 100).toFixed(2)} % of ${usd(a.totalSupplyAssets, 0)} USDG supplied · ${usd(a.totalSupplyAssets - a.totalBorrowAssets, 0)} USDG idle`
      : 'nothing supplied yet',
  };
}

export interface BorrowTiles { collateral: TileView; debt: TileView; ltv: TileView; room: TileView; ltvLabel: string }

export function borrowTiles(a: AccountState | null, s: Pick<Snapshot, 'price' | 'haircutNowBps'> | null, lltv: bigint | null, symbol: string): BorrowTiles {
  const lb = lltvBpsOf(lltv ?? DEFAULT_LLTV);
  const ltvLabel = `LTV · LLTV ${lb / 100} %`;
  if (!a) return { collateral: EMPTY, debt: EMPTY, ltv: EMPTY, room: EMPTY, ltvLabel };
  const price = s?.price ?? null;
  const value = price === null ? null : collateralValue(a.collateral, price);
  const ltv = price === null ? null : ltvBps(a.collateral, price, a.debt);
  const room = borrowRoom(a, price, lltv);
  return {
    ltvLabel,
    collateral: { value: `${stk(a.collateral)} ${symbol}`, note: value === null ? 'oracle not pricing' : `≈ ${usd(value)} USDG at the oracle price` },
    debt: { value: `${usd(a.debt)} USDG`, note: a.debt > 0n ? 'accrues the market rate; the premium is separate' : 'no debt' },
    ltv: {
      value: ltv === null ? '—' : fmtBps(ltv),
      warn: ltv !== null && ltv >= 8000,
      note: ltv === null ? '' : ltv >= lb ? 'liquidatable' : ltv >= 8000 ? 'above the 76 % unwind target' : 'healthy',
    },
    room: {
      value: room === null ? '—' : `${usd(room > 0n ? room : 0n)} USDG`,
      note: price === null
        ? 'the oracle reverts — borrows and liquidations are paused'
        : `at ${fmtUsd(Number(price / 10n ** 12n) / 1e12, 2)} USDG per ${symbol} (haircut ${fmtBps(s?.haircutNowBps ?? 0)} in force)`,
    },
  };
}

export const BORROW_HINT = 'Borrowing power is computed at the oracle price — the haircut in force reduces it during a closure.';

export function borrowPreview(input: string, a: AccountState | null, price: bigint | null, lltv: bigint | null): string {
  const v = parseAmount(input, 6);
  if (!a || lltv === null || price === null || v === null) return BORROW_HINT;
  const after = ltvBps(a.collateral, price, a.debt + v);
  const lb = lltvBpsOf(lltv);
  return after > lb
    ? `LTV after: ${fmtBps(after)} — above the ${fmtBps(lb)} LLTV, Morpho would reject it.`
    : `LTV after: ${fmtBps(after)} of ${fmtBps(lb)}${after > 7600 ? ' — above the 76 % unwind target: a member would be unwound before the next close' : ''}.`;
}

export interface MemberTiles { membership: TileView; escrow: TileView; joinNote: string }

export function memberTiles(a: AccountState | null): MemberTiles {
  if (!a) return { membership: EMPTY, escrow: EMPTY, joinNote: '' };
  const state = a.member ? 'Member' : a.authorized ? (a.delinquent ? 'Delinquent' : 'Authorised') : 'Not a member';
  return {
    membership: {
      value: state,
      warn: a.authorized && a.delinquent,
      note: a.member
        ? 'soft unwind before the close and shortfall cover are active'
        : a.authorized
          ? `escrow below what is owed plus the 7-day reserve (${usd(a.minReserve)} USDG) — top up to restore cover`
          : 'authorise the soft unwind, then fund the escrow',
    },
    escrow: { value: `${usd(a.escrow)} USDG`, note: `owed ${usd(a.owed)} · reserve ${usd(a.minReserve)} · premium paid so far ${usd(a.paid)}` },
    joinNote: a.authorized
      ? 'Revoking ends membership: no soft unwind, no cover, and the escrow stays yours.'
      : 'Lets VigilPreLiquidation repay part of your debt before a closure, at a discount it charges the unwinder, never you.',
  };
}

export interface BackstopTiles { deposit: TileView; vault: TileView }

export function backstopTiles(a: AccountState | null, s: Pick<Snapshot, 'backstopAssets' | 'coverageCap' | 'totalCovered'> | null): BackstopTiles {
  if (!a) return { deposit: EMPTY, vault: EMPTY };
  return {
    deposit: {
      value: `${usd(a.vgAssets)} USDG`,
      note: `${Number(formatUnits(a.vgShares, a.vgDecimals)).toLocaleString('en-US', { maximumFractionDigits: 4 })} vgUSDG shares at the current share price`,
    },
    vault: s ? { value: `${usd(s.backstopAssets, 0)} USDG`, note: `coverage cap ${usd(s.coverageCap, 0)} · covered so far ${usd(s.totalCovered)}` } : EMPTY,
  };
}

export function requestStatus(r: WithdrawRequest, nowSec: number, marketOpen: boolean): { text: string; claimable: boolean } {
  const ready = nowSec >= r.readyAt;
  return {
    text: r.claimed ? 'claimed' : ready ? (marketOpen ? 'ready' : 'ready — claim during MARKET') : `cooldown ${fmtDuration(r.readyAt - nowSec)}`,
    claimable: !r.claimed && ready && marketOpen,
  };
}

export const MIGRATE_HINT = 'Paste the id of a Morpho market you supply to; the whole position moves here in one transaction (you sign the authorisation, the contract withdraws and re-supplies for you).';

export function describeLegacy(l: Legacy | null, usdg: string): string {
  if (!l) return 'No market with that id on this Morpho.';
  const sameLoan = l.params[0].toLowerCase() === usdg.toLowerCase();
  return `${sameLoan ? '' : 'Different loan token — cannot migrate. '}Your supply there: ${usd(l.assets)} USDG · LLTV ${fmtBps(lltvBpsOf(l.params[4]))} · oracle ${shortAddr(l.params[2])} (plain, no session awareness).`;
}

/** Action buttons are enabled only when a wallet is connected, on the deployment's chain, read, and idle. */
export function walletReady(
  w: { address: string | null; account: AccountState | null; params: Pick<MarketParams, 'lltv'> | null; chainId: number | null; busy: boolean },
  chainId: number,
): boolean {
  return w.address !== null && w.account !== null && w.params !== null && w.chainId === chainId && !w.busy;
}
