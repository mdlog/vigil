import { IS_TESTNET, SYMBOL, type ContractName } from '../deployment';

/** What each contract in the manifest does (moved from web/src/panels/contracts.ts @ 7f9d414). */
export const ROLE: Record<ContractName, string> = {
  VigilCalendar: 'NYSE session calendar from block.timestamp (DST, holidays)',
  VigilSessionOracle: 'effective regime, feed freshness, keeper attestations, premium index',
  VigilRiskEngine: 'haircut surface H(L), scheduled events, premium tables',
  VigilOracle: 'Morpho IOracle: feed × (1 − min(H, cap))',
  VigilPremium: 'USDG premium escrow and membership',
  VigilBackstop: 'ERC-4626 first-loss tranche',
  VigilPreLiquidation: 'session-aware soft unwind (Morpho PreLiquidation pattern)',
  VigilLossReporter: 'liquidateWithCover: the backstop repays the shortfall before seizure',
  Morpho: IS_TESTNET ? 'Morpho Blue, deployed from source (the testnet has none)' : 'Morpho Blue — the live singleton on Robinhood Chain',
  IRM: 'AdaptiveCurveIRM — the live Morpho interest rate model',
  USDG: IS_TESTNET ? 'Global Dollar — the real Paxos USDG issued on the testnet (faucet.paxos.com), 6 decimals' : 'Global Dollar — Paxos USDG, 6 decimals — the loan token',
  MockUSDG: 'mock loan token, 6 decimals',
  StockToken: IS_TESTNET
    ? `Robinhood's own ${SYMBOL} stock token on the testnet (ERC-8056, registry 0x1dF3…6Ca5) — the collateral`
    : `Robinhood's ${SYMBOL} stock token (ERC-8056, transfer-restricted through its registry) — the collateral`,
  MockStockToken: `mock ERC-8056 ${SYMBOL} stock token`,
  Feed: `Chainlink ${SYMBOL}/USD feed, 8 decimals — what VigilSessionOracle judges for freshness`,
  UsdgFeed: 'Chainlink USDG/USD feed, 8 decimals — the quote leg of VigilOracle',
  MockFeed: `mock Chainlink ${SYMBOL}/USD feed, 8 decimals (the testnet has no Chainlink feeds)`,
  MockIRM: 'mock interest rate model',
  VigilMigrator: 'moves a supply position from any USDG market into the Vigil market in one transaction (EIP-712 authorisation inside the call)',
  LegacyOracle: `plain ${SYMBOL}/USD oracle of the 62.5 % demo market — what a market without Vigil looks like`,
};

export const ISSUER: Partial<Record<ContractName, string>> = {
  USDG: 'issued by Paxos', StockToken: 'issued by Robinhood', Morpho: 'Morpho Labs', IRM: 'Morpho Labs', Feed: 'Chainlink', UsdgFeed: 'Chainlink',
};
