import { getAddress } from 'viem';
// The manifest is chosen at build time: `@manifest` resolves to deployments/robinhood-testnet-46630.json unless
// VIGIL_MANIFEST names another one (vite.config.ts), so the same page serves the testnet and a mainnet deployment.
import manifest from '@manifest';

export type ContractName =
  | 'VigilCalendar' | 'VigilSessionOracle' | 'VigilRiskEngine' | 'VigilOracle'
  | 'VigilBackstop' | 'VigilPremium' | 'VigilPreLiquidation' | 'VigilLossReporter'
  | 'Morpho' | 'IRM' | 'USDG' | 'MockUSDG' | 'StockToken' | 'MockStockToken' | 'Feed' | 'UsdgFeed' | 'MockFeed' | 'MockIRM'
  | 'VigilMigrator' | 'LegacyOracle';

export const CHAIN_ID = manifest.chainId as number;
export const NETWORK_NAME = ((manifest as { network?: string }).network ?? `chain ${CHAIN_ID}`) as string;
export const IS_TESTNET = CHAIN_ID !== 4663;
export const RPC_URL = manifest.rpc as string;
export const EXPLORER = manifest.explorer as string;
export const DEPLOYER = getAddress(manifest.deployer);
export const DEPLOYED_AT = manifest.deployedAt as string;
export const MARKET_ID = manifest.market.id as `0x${string}`;
/** Ticker of the collateral (the mock NVDA on v1–v3, Robinhood's own TSLA token from v4). */
export const SYMBOL = ((manifest.market as { collateralSymbol?: string }).collateralSymbol ?? 'NVDA') as string;
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;

export const ADDR = Object.fromEntries(
  Object.entries(manifest.contracts).map(([name, c]) => [name, getAddress((c as { address: string }).address)]),
) as Record<ContractName, `0x${string}`>;

/** Display order; a name absent from the manifest (MockUSDG on a real-USDG deployment) is skipped. */
export const CONTRACT_ORDER: ContractName[] = ([
  'VigilCalendar', 'VigilSessionOracle', 'VigilRiskEngine', 'VigilOracle', 'VigilPremium',
  'VigilBackstop', 'VigilPreLiquidation', 'VigilLossReporter', 'Morpho', 'IRM', 'USDG', 'MockUSDG', 'StockToken', 'MockStockToken',
  'Feed', 'UsdgFeed', 'MockFeed', 'MockIRM', 'VigilMigrator', 'LegacyOracle',
] as ContractName[]).filter((n) => n in manifest.contracts);

/** The plain-oracle 62.5 % market of the migration demo, when the deployment has one. */
export const LEGACY_MARKET_ID = ((manifest as { legacyMarket?: { id: string } }).legacyMarket?.id ?? null) as `0x${string}` | null;

/** The collateral and its price feed, whichever kind this deployment has. */
export const ASSET = (ADDR.StockToken ?? ADDR.MockStockToken) as `0x${string}`;
export const FEED = (ADDR.Feed ?? ADDR.MockFeed) as `0x${string}`;
/** True when the deployment's feed or IRM is one of our mocks (testnet 46630 has neither Chainlink nor Morpho). */
export const HAS_MOCKS = 'MockFeed' in manifest.contracts || 'MockIRM' in manifest.contracts || 'MockUSDG' in manifest.contracts || 'MockStockToken' in manifest.contracts;

/** Deploy transaction per contract; undefined for a contract Vigil did not deploy (Paxos's USDG, Robinhood's stock token). */
export const TX_OF: Partial<Record<ContractName, `0x${string}`>> = Object.fromEntries(
  Object.entries(manifest.contracts).flatMap(([name, c]) => ((c as { tx?: string }).tx ? [[name, (c as { tx: string }).tx]] : [])),
) as Partial<Record<ContractName, `0x${string}`>>;

export const explorerAddress = (a: string) => `${EXPLORER}/address/${a}`;
export const explorerTx = (h: string) => `${EXPLORER}/tx/${h}`;
