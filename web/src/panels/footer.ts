import { el } from '../ui/dom';
import { DEPLOYED_AT, DEPLOYER, HAS_MOCKS, IS_TESTNET, SYMBOL, explorerAddress } from '../deployment';
import type { Panel } from './types';

export function createFooter(): Panel {
  const root = el('footer', { class: 'site-footer reveal' },
    el('p', {}, IS_TESTNET
      ? `Read-only view of a testnet deployment — USDG is Paxos's testnet Global Dollar and the collateral is Robinhood's ${SYMBOL} token${HAS_MOCKS ? '; the price feed and the IRM are mocks (the testnet has no Chainlink feeds)' : ''}. `
      : `Read-only view of the mainnet deployment — Paxos USDG, Robinhood's ${SYMBOL} token, the Chainlink ${SYMBOL}/USD feed and Morpho Blue are the live ones. `,
      el('a', { href: explorerAddress(DEPLOYER), target: '_blank', rel: 'noopener', text: `deployer ${DEPLOYER.slice(0, 6)}…${DEPLOYER.slice(-4)}` }),
      ` · deployed ${DEPLOYED_AT.slice(0, 10)} · build ${__COMMIT__} · ${__BUILD_TIME__.slice(0, 16).replace('T', ' ')} UTC`),
  );
  return { root, render() {} };
}
