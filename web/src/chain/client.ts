import { createPublicClient, defineChain, http } from 'viem';
import { CHAIN_ID, MULTICALL3, RPC_URL } from '../deployment';

export const robinhoodTestnet = defineChain({
  id: CHAIN_ID,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  contracts: { multicall3: { address: MULTICALL3 } },
});

export const client = createPublicClient({
  chain: robinhoodTestnet,
  transport: http(RPC_URL, { timeout: 10_000, retryCount: 1 }),
});
export type Client = typeof client;
