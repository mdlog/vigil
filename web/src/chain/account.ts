/** Everything the transaction panel shows about one wallet, read in one multicall, plus its backstop withdrawal
 *  requests from the vault's logs. */
import { parseAbiItem, type Address, type PublicClient } from 'viem';
import manifest from '@manifest';
import { ADDR, ASSET, MARKET_ID } from '../deployment';
import { erc20Abi } from '../abi/erc20';
import { morphoAbi } from '../abi/morpho';
import { vigilPremiumAbi } from '../abi/vigilPremium';
import { vigilBackstopAbi } from '../abi/vigilBackstop';
import { debtOf, suppliedOf } from './math';

export interface MarketParams { loanToken: Address; collateralToken: Address; oracle: Address; irm: Address; lltv: bigint }

export interface AccountState {
  address: Address;
  eth: bigint; usdg: bigint; stock: bigint;
  // Morpho
  supplyShares: bigint; supplied: bigint; borrowShares: bigint; debt: bigint; collateral: bigint;
  totalSupplyAssets: bigint; totalSupplyShares: bigint; totalBorrowAssets: bigint; totalBorrowShares: bigint;
  authorized: boolean;
  // membership
  member: boolean; delinquent: boolean; escrow: bigint; owed: bigint; paid: bigint; minReserve: bigint;
  // backstop (shares carry 6 + 6 decimals: the vault's virtual-share offset)
  vgShares: bigint; vgAssets: bigint; vgDecimals: number;
}

export interface WithdrawRequest { id: bigint; shares: bigint; assetsNow: bigint; readyAt: number; claimed: boolean }

export async function readMarketParams(client: PublicClient): Promise<MarketParams> {
  const [loanToken, collateralToken, oracle, irm, lltv] = await client.readContract({
    address: ADDR.Morpho, abi: morphoAbi, functionName: 'idToMarketParams', args: [MARKET_ID],
  });
  return { loanToken, collateralToken, oracle, irm, lltv };
}

export async function readAccount(client: PublicClient, address: Address): Promise<AccountState> {
  const morpho = { address: ADDR.Morpho, abi: morphoAbi } as const;
  const premium = { address: ADDR.VigilPremium, abi: vigilPremiumAbi } as const;
  const backstop = { address: ADDR.VigilBackstop, abi: vigilBackstopAbi } as const;
  const usdgAddr = ADDR.USDG ?? ADDR.MockUSDG;
  const [eth, r] = await Promise.all([
    client.getBalance({ address }),
    client.multicall({
      allowFailure: false,
      contracts: [
        { address: usdgAddr, abi: erc20Abi, functionName: 'balanceOf', args: [address] },
        { address: ASSET, abi: erc20Abi, functionName: 'balanceOf', args: [address] },
        { ...morpho, functionName: 'position', args: [MARKET_ID, address] },
        { ...morpho, functionName: 'market', args: [MARKET_ID] },
        { ...morpho, functionName: 'isAuthorized', args: [address, ADDR.VigilPreLiquidation] },
        { ...premium, functionName: 'isMember', args: [MARKET_ID, address] },
        { ...premium, functionName: 'isDelinquent', args: [MARKET_ID, address] },
        { ...premium, functionName: 'escrowOf', args: [MARKET_ID, address] },
        { ...premium, functionName: 'minReserve', args: [MARKET_ID, address] },
        { ...backstop, functionName: 'balanceOf', args: [address] },
        { ...backstop, functionName: 'decimals' },
      ],
    }),
  ]);
  const [usdg, stock, position, market, authorized, member, delinquent, escrow, minReserve, vgShares, vgDecimals] = r;
  const [supplyShares, borrowShares, collateral] = position;
  const [totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares] = market;
  const vgAssets = vgShares > 0n
    ? await client.readContract({ ...backstop, functionName: 'previewRedeem', args: [vgShares] })
    : 0n;
  return {
    address, eth, usdg, stock,
    supplyShares, supplied: suppliedOf(supplyShares, totalSupplyAssets, totalSupplyShares),
    borrowShares, debt: debtOf(borrowShares, totalBorrowAssets, totalBorrowShares), collateral,
    totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares,
    authorized, member, delinquent,
    escrow: escrow.balance, owed: escrow.owed, paid: escrow.paid, minReserve,
    vgShares, vgAssets, vgDecimals,
  };
}

const WITHDRAW_REQUESTED = parseAbiItem('event WithdrawRequested(uint256 indexed id, address indexed owner, uint256 shares, uint64 readyAt)');

/** The wallet's withdrawal requests (WithdrawRequested logs since the vault was deployed) with their claimed flag. */
export async function readRequests(client: PublicClient, address: Address): Promise<WithdrawRequest[]> {
  const from = BigInt((manifest as { firstBlock?: number }).firstBlock ?? 0);
  const logs = await client.getLogs({ address: ADDR.VigilBackstop, event: WITHDRAW_REQUESTED, args: { owner: address }, fromBlock: from, toBlock: 'latest' });
  if (!logs.length) return [];
  const rows = await client.multicall({
    allowFailure: false,
    contracts: logs.map((l) => ({ address: ADDR.VigilBackstop, abi: vigilBackstopAbi, functionName: 'requests', args: [l.args.id!] } as const)),
  });
  const values = await client.multicall({
    allowFailure: false,
    contracts: rows.map((r) => ({ address: ADDR.VigilBackstop, abi: vigilBackstopAbi, functionName: 'previewRedeem', args: [r[1]] } as const)),
  });
  return logs.map((l, i) => {
    const [, shares, readyAt, claimed] = rows[i]!;
    return { id: l.args.id!, shares, assetsNow: values[i]!, readyAt: Number(readyAt), claimed };
  });
}
