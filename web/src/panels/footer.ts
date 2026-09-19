import { el } from '../ui/dom';
import { DEPLOYED_AT, DEPLOYER, explorerAddress } from '../deployment';
import type { Panel } from './types';

export function createFooter(): Panel {
  const root = el('footer', { class: 'site-footer reveal' },
    el('p', {}, 'Read-only view of a testnet deployment — USDG is Paxos\'s testnet Global Dollar; the NVDA token, the price feed and the IRM are mocks. ',
      el('a', { href: explorerAddress(DEPLOYER), target: '_blank', rel: 'noopener', text: `deployer ${DEPLOYER.slice(0, 6)}…${DEPLOYER.slice(-4)}` }),
      ` · deployed ${DEPLOYED_AT.slice(0, 10)} · build ${__COMMIT__} · ${__BUILD_TIME__.slice(0, 16).replace('T', ' ')} UTC`),
  );
  return { root, render() {} };
}
