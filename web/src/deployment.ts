import { getAddress } from 'viem';
import manifest from '../../deployments/robinhood-testnet-46630.json';

export type ContractName =
  | 'VigilCalendar' | 'VigilSessionOracle' | 'VigilRiskEngine' | 'VigilOracle'
  | 'VigilBackstop' | 'VigilPremium' | 'VigilPreLiquidation' | 'VigilLossReporter'
  | 'Morpho' | 'USDG' | 'MockUSDG' | 'MockStockToken' | 'MockFeed' | 'MockIRM';

export const CHAIN_ID = manifest.chainId as number;
export const RPC_URL = manifest.rpc as string;
export const EXPLORER = manifest.explorer as string;
export const DEPLOYER = getAddress(manifest.deployer);
export const DEPLOYED_AT = manifest.deployedAt as string;
export const MARKET_ID = manifest.market.id as `0x${string}`;
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;

export const ADDR = Object.fromEntries(
  Object.entries(manifest.contracts).map(([name, c]) => [name, getAddress((c as { address: string }).address)]),
) as Record<ContractName, `0x${string}`>;

/** Display order; a name absent from the manifest (MockUSDG on a real-USDG deployment) is skipped. */
export const CONTRACT_ORDER: ContractName[] = ([
  'VigilCalendar', 'VigilSessionOracle', 'VigilRiskEngine', 'VigilOracle', 'VigilPremium',
  'VigilBackstop', 'VigilPreLiquidation', 'VigilLossReporter', 'Morpho', 'USDG', 'MockUSDG', 'MockStockToken', 'MockFeed', 'MockIRM',
] as ContractName[]).filter((n) => n in manifest.contracts);

/** Deploy transaction per contract; undefined for a contract Vigil did not deploy (Paxos's USDG). */
export const TX_OF: Partial<Record<ContractName, `0x${string}`>> = Object.fromEntries(
  Object.entries(manifest.contracts).flatMap(([name, c]) => ((c as { tx?: string }).tx ? [[name, (c as { tx: string }).tx]] : [])),
) as Partial<Record<ContractName, `0x${string}`>>;

export const explorerAddress = (a: string) => `${EXPLORER}/address/${a}`;
export const explorerTx = (h: string) => `${EXPLORER}/tx/${h}`;
