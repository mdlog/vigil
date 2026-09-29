import { DEPLOYED_AT, DEPLOYER, HAS_MOCKS, IS_TESTNET, explorerAddress, type Market } from '../deployment';
import { shortAddr } from '../ui/format';

/** What the deployment is made of, naming the chosen market's token. */
export function deploymentNote(symbol: string): string {
  return IS_TESTNET
    ? `Testnet deployment — USDG is Paxos's testnet Global Dollar and the collateral is Robinhood's ${symbol} token${HAS_MOCKS ? '; the price feed and the IRM are mocks (the testnet has no Chainlink feeds)' : ''}.`
    : `Mainnet deployment — Paxos USDG, Robinhood's ${symbol} token, the Chainlink ${symbol}/USD feed and Morpho Blue are the live ones.`;
}

export function Footer({ market }: { market: Market }) {
  return (
    <footer className="dashboard-footer">
      <span>{deploymentNote(market.symbol)}</span>
      <span>
        <a href={explorerAddress(DEPLOYER)} target="_blank" rel="noreferrer">deployer {shortAddr(DEPLOYER)}</a>
        {' '}· deployed {DEPLOYED_AT.slice(0, 10)} · build {__COMMIT__} · {__BUILD_TIME__.slice(0, 16).replace('T', ' ')} UTC
      </span>
    </footer>
  );
}
