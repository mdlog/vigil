/** Transaction builders for the "Use it" tab, ported 1:1 from web/src/panels/use.ts @ 7f9d414. A builder returns the
 *  steps of one user action — an approval is prepended only when the allowance is short — and every step simulates
 *  before it asks the wallet, so a revert surfaces as its custom error instead of a failed transaction. No DOM, no React. */
import { formatUnits, isHex, parseSignature, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { ADDR, ASSET, CHAIN_ID, MARKET_ID, SYMBOL } from '../deployment';
import { erc20Abi } from '../abi/erc20';
import { morphoAbi } from '../abi/morpho';
import { vigilPremiumAbi } from '../abi/vigilPremium';
import { vigilBackstopAbi } from '../abi/vigilBackstop';
import { vigilMigratorAbi } from '../abi/vigilMigrator';
import type { AccountState, MarketParams } from '../chain/account';
import { parseAmount, suppliedOf } from '../chain/math';
import { shortAddr } from '../ui/format';
import { stk, usd } from './units';

export const USDG = (ADDR.USDG ?? ADDR.MockUSDG) as Address;
const NONE = '0x' as Hex;
const ZERO32 = `0x${'0'.repeat(64)}` as Hex;

export type Step = { label: string; send: () => Promise<Hex> };

export interface TxContext {
  client: PublicClient;
  wallet: WalletClient;
  account: Address;
  /** The Vigil market's params (Morpho's `idToMarketParams(MARKET_ID)`). */
  params: MarketParams;
  /** Progress text for a step that needs more than one wallet prompt (the migration's signature). */
  say: (text: string) => void;
}

type Write = { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] };

/** Simulate, then send through the wallet. */
export const writeStep = (ctx: TxContext, w: Write) => async (): Promise<Hex> => {
  const { request } = await ctx.client.simulateContract({ ...w, account: ctx.account } as never);
  return ctx.wallet.writeContract(request as never);
};

const morpho = (functionName: string, args: readonly unknown[]): Write => ({ address: ADDR.Morpho, abi: morphoAbi, functionName, args });
const premium = (functionName: string, args: readonly unknown[]): Write => ({ address: ADDR.VigilPremium, abi: vigilPremiumAbi, functionName, args });
const backstop = (functionName: string, args: readonly unknown[]): Write => ({ address: ADDR.VigilBackstop, abi: vigilBackstopAbi, functionName, args });

export async function approveSteps(ctx: TxContext, token: Address, spender: Address, amount: bigint, what: string): Promise<Step[]> {
  const allowance = (await ctx.client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [ctx.account, spender] })) as bigint;
  if (allowance >= amount) return [];
  return [{ label: `Approve ${what}`, send: writeStep(ctx, { address: token, abi: erc20Abi, functionName: 'approve', args: [spender, amount] }) }];
}

// ── Lend ──
export const supply = async (ctx: TxContext, v: bigint): Promise<Step[]> => [
  ...(await approveSteps(ctx, USDG, ADDR.Morpho, v, 'USDG for Morpho')),
  { label: `Supply ${usd(v)} USDG`, send: writeStep(ctx, morpho('supply', [ctx.params, v, 0n, ctx.account, NONE])) },
];
/** The whole position is withdrawn by shares, so it closes exactly. */
export const withdraw = async (ctx: TxContext, a: AccountState, v: bigint): Promise<Step[]> => {
  const all = v === a.supplied;
  return [{ label: `Withdraw ${usd(v)} USDG`, send: writeStep(ctx, morpho('withdraw', [ctx.params, all ? 0n : v, all ? a.supplyShares : 0n, ctx.account, ctx.account])) }];
};

// ── Borrow ──
export const addCollateral = async (ctx: TxContext, v: bigint): Promise<Step[]> => [
  ...(await approveSteps(ctx, ASSET, ADDR.Morpho, v, `${SYMBOL} for Morpho`)),
  { label: `Add ${stk(v)} ${SYMBOL} collateral`, send: writeStep(ctx, morpho('supplyCollateral', [ctx.params, v, ctx.account, NONE])) },
];
export const borrow = async (ctx: TxContext, v: bigint): Promise<Step[]> => [
  { label: `Borrow ${usd(v)} USDG`, send: writeStep(ctx, morpho('borrow', [ctx.params, v, 0n, ctx.account, ctx.account])) },
];
/** Repaying the whole debt goes by shares, so no dust is left. */
export const repay = async (ctx: TxContext, a: AccountState, v: bigint): Promise<Step[]> => {
  const all = v === a.debt;
  return [
    ...(await approveSteps(ctx, USDG, ADDR.Morpho, v, 'USDG for Morpho')),
    { label: `Repay ${usd(v)} USDG`, send: writeStep(ctx, morpho('repay', [ctx.params, all ? 0n : v, all ? a.borrowShares : 0n, ctx.account, NONE])) },
  ];
};
export const withdrawCollateral = async (ctx: TxContext, v: bigint): Promise<Step[]> => [
  { label: `Withdraw ${stk(v)} ${SYMBOL}`, send: writeStep(ctx, morpho('withdrawCollateral', [ctx.params, v, ctx.account, ctx.account])) },
];

// ── Member ──
export const join = async (ctx: TxContext): Promise<Step[]> => [
  { label: 'Authorise VigilPreLiquidation on your Morpho position', send: writeStep(ctx, morpho('setAuthorization', [ADDR.VigilPreLiquidation, true])) },
];
export const leave = async (ctx: TxContext): Promise<Step[]> => [
  { label: 'Revoke VigilPreLiquidation', send: writeStep(ctx, morpho('setAuthorization', [ADDR.VigilPreLiquidation, false])) },
];
export const topUp = async (ctx: TxContext, v: bigint): Promise<Step[]> => [
  ...(await approveSteps(ctx, USDG, ADDR.VigilPremium, v, 'USDG for the premium escrow')),
  { label: `Top up escrow by ${usd(v)} USDG`, send: writeStep(ctx, premium('topUp', [MARKET_ID, ctx.account, v])) },
];
export const withdrawUnused = async (ctx: TxContext, v: bigint): Promise<Step[]> => [
  { label: `Withdraw ${usd(v)} USDG from escrow`, send: writeStep(ctx, premium('withdrawUnused', [MARKET_ID, v])) },
];

// ── Backstop ──
export const deposit = async (ctx: TxContext, v: bigint): Promise<Step[]> => [
  ...(await approveSteps(ctx, USDG, ADDR.VigilBackstop, v, 'USDG for the backstop')),
  { label: `Deposit ${usd(v)} USDG into the backstop`, send: writeStep(ctx, backstop('deposit', [v, ctx.account])) },
];
/** The vault takes shares: all of them for the whole deposit, else previewWithdraw's (rounded-up) amount. */
export const requestWithdraw = async (ctx: TxContext, a: AccountState, v: bigint): Promise<Step[]> => {
  const shares = v >= a.vgAssets
    ? a.vgShares
    : ((await ctx.client.readContract({ address: ADDR.VigilBackstop, abi: vigilBackstopAbi, functionName: 'previewWithdraw', args: [v] })) as bigint);
  return [{ label: `Request withdrawal of ${usd(v)} USDG (${formatUnits(shares, a.vgDecimals)} shares)`, send: writeStep(ctx, backstop('requestWithdraw', [shares])) }];
};
export const claim = async (ctx: TxContext, id: bigint): Promise<Step[]> => [
  { label: `Claim request #${id}`, send: writeStep(ctx, backstop('claimWithdraw', [id])) },
];

// ── Migrate: leave any other USDG market on this Morpho for the Vigil market in one transaction (VigilMigrator) ──
export type Legacy = { params: readonly [Address, Address, Address, Address, bigint]; shares: bigint; assets: bigint };

export const isMarketId = (id: string): id is Hex => isHex(id) && id.length === 66;

export async function readLegacy(client: PublicClient, account: Address, id: Hex): Promise<Legacy | null> {
  const [params, position, market] = (await Promise.all([
    client.readContract({ address: ADDR.Morpho, abi: morphoAbi, functionName: 'idToMarketParams', args: [id] }),
    client.readContract({ address: ADDR.Morpho, abi: morphoAbi, functionName: 'position', args: [id, account] }),
    client.readContract({ address: ADDR.Morpho, abi: morphoAbi, functionName: 'market', args: [id] }),
  ])) as unknown as [Legacy['params'], readonly [bigint, bigint, bigint], readonly [bigint, bigint, bigint, bigint, bigint, bigint]];
  if (params[0] === '0x0000000000000000000000000000000000000000') return null;
  return { params, shares: position[0], assets: suppliedOf(position[0], market[0], market[1]) };
}

/** Why a migration cannot start, or null when it can. */
export function migratePrecheck(l: Legacy | null): string | null {
  if (!l) return 'No market with that id on this Morpho.';
  if (l.params[0].toLowerCase() !== USDG.toLowerCase()) return 'That market lends a different token.';
  if (l.shares === 0n) return 'You have no supply in that market.';
  return null;
}

const AUTH_TYPES = {
  Authorization: [
    { name: 'authorizer', type: 'address' }, { name: 'authorized', type: 'address' }, { name: 'isAuthorized', type: 'bool' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
  ],
} as const;

/** One VigilMigrator call; Morpho's EIP-712 authorisation is signed in the wallet first when the migrator lacks it. */
export const migrate = async (ctx: TxContext, id: Hex, l: Legacy): Promise<Step[]> => {
  const migrator = ADDR.VigilMigrator;
  const from = { loanToken: l.params[0], collateralToken: l.params[1], oracle: l.params[2], irm: l.params[3], lltv: l.params[4] };
  return [{
    label: `Migrate ${usd(l.assets)} USDG from ${shortAddr(id)} into the Vigil market`,
    send: async () => {
      const me = ctx.account;
      const authorized = (await ctx.client.readContract({ address: ADDR.Morpho, abi: morphoAbi, functionName: 'isAuthorized', args: [me, migrator] })) as boolean;
      let auth = { authorizer: me, authorized: migrator, isAuthorized: true, nonce: 0n, deadline: 0n };
      let sig: { v: number; r: Hex; s: Hex } = { v: 27, r: ZERO32, s: ZERO32 };
      if (!authorized) {
        const nonce = (await ctx.client.readContract({ address: ADDR.Morpho, abi: morphoAbi, functionName: 'nonce', args: [me] })) as bigint;
        auth = { ...auth, nonce, deadline: BigInt(Math.floor(Date.now() / 1000) + 3600) };
        ctx.say('Sign the Morpho authorisation in the wallet (a signature, no gas)…');
        const signed = await ctx.wallet.signTypedData({
          account: me,
          domain: { chainId: CHAIN_ID, verifyingContract: ADDR.Morpho }, // Morpho's domain has no name or version
          types: AUTH_TYPES,
          primaryType: 'Authorization',
          message: auth,
        });
        const p = parseSignature(signed);
        sig = { v: Number(p.v ?? (p.yParity === 1 ? 28n : 27n)), r: p.r, s: p.s };
        ctx.say('Authorisation signed — now confirm the migration transaction…');
      }
      return writeStep(ctx, { address: migrator, abi: vigilMigratorAbi, functionName: 'migrate', args: [from, ctx.params, l.shares, auth, sig] })();
    },
  }];
};

/** Public RPCs can lag a block behind the receipt: re-read the old position until it has moved (at most 5 tries). */
export async function settleLegacy(client: PublicClient, account: Address, id: Hex, sharesBefore: bigint, waitMs = 1500): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const now = await readLegacy(client, account, id).catch(() => null);
    if (!now || now.shares !== sharesBefore) return;
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

export type Parsed = { ok: true; value: bigint } | { ok: false; error: string };

/** The panel's input rule: a positive amount with at most `decimals` fraction digits, not above `limit`. */
export function validateAmount(input: string, decimals: number, limit: bigint | null, what: string): Parsed {
  const v = parseAmount(input, decimals);
  if (v === null) return { ok: false, error: `Enter a positive ${what} amount with at most ${decimals} decimals.` };
  if (limit !== null && v > limit) return { ok: false, error: `That is more than the ${formatUnits(limit, decimals)} ${what} available.` };
  return { ok: true, value: v };
}
