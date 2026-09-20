import { createPublicClient, defineChain, http } from 'viem';
import { CHAIN_ID, MULTICALL3, NETWORK_NAME, RPC_URL } from '../deployment';

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: NETWORK_NAME,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  contracts: { multicall3: { address: MULTICALL3 } },
});

/** `?rpc=http://127.0.0.1:8546` points the page at a local fork for rehearsals; only loopback hosts are honoured. */
export function rpcOverride(search: string = typeof location !== 'undefined' ? location.search : ''): string | null {
  const v = new URLSearchParams(search).get('rpc');
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' ? u.toString() : null;
  } catch {
    return null;
  }
}

export const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(rpcOverride() ?? RPC_URL, { timeout: 10_000, retryCount: 1 }),
});
export type Client = typeof client;
