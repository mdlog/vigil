import { DEPLOYED_AT, DEPLOYER, HAS_MOCKS, IS_TESTNET, SYMBOL, explorerAddress } from '../deployment';
import { shortAddr } from '../ui/format';

export function Footer() {
  return (
    <footer className="dashboard-footer">
      <span>
        {IS_TESTNET
          ? `Testnet deployment — USDG is Paxos's testnet Global Dollar and the collateral is Robinhood's ${SYMBOL} token${HAS_MOCKS ? '; the price feed and the IRM are mocks (the testnet has no Chainlink feeds)' : ''}.`
          : `Mainnet deployment — Paxos USDG, Robinhood's ${SYMBOL} token, the Chainlink ${SYMBOL}/USD feed and Morpho Blue are the live ones.`}
      </span>
      <span>
        <a href={explorerAddress(DEPLOYER)} target="_blank" rel="noreferrer">deployer {shortAddr(DEPLOYER)}</a>
        {' '}· deployed {DEPLOYED_AT.slice(0, 10)} · build {__COMMIT__} · {__BUILD_TIME__.slice(0, 16).replace('T', ' ')} UTC
      </span>
    </footer>
  );
}
