/** Injected-wallet (EIP-1193) plumbing for the transaction panel: connect, keep the wallet on the deployment's chain,
 *  and expose a viem wallet client. No WalletConnect and no dependency beyond viem — the page stays a static file. */
import { createWalletClient, custom, type Address, type EIP1193Provider, type WalletClient } from 'viem';
import { CHAIN_ID, EXPLORER, NETWORK_NAME, RPC_URL } from '../deployment';
import { robinhoodChain } from './client';

export interface WalletState { address: Address | null; chainId: number | null }

/** wallet_addEthereumChain parameters for this deployment (pure, so it is testable). */
export function chainParams(chainId = CHAIN_ID, name = NETWORK_NAME, rpc = RPC_URL, explorer = EXPLORER) {
  return {
    chainId: `0x${chainId.toString(16)}`,
    chainName: name,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: [rpc],
    blockExplorerUrls: [explorer],
  };
}

export function provider(): EIP1193Provider | null {
  const w = globalThis as { ethereum?: EIP1193Provider };
  return w.ethereum ?? null;
}

export async function currentChainId(p: EIP1193Provider): Promise<number> {
  return Number(await p.request({ method: 'eth_chainId' }));
}

/** Switches the wallet to the deployment's chain, adding it first when the wallet does not know it (EIP-3085/3326). */
export async function ensureChain(p: EIP1193Provider): Promise<void> {
  const hex = `0x${CHAIN_ID.toString(16)}`;
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code !== 4902 && !/unrecognized|not added|4902/i.test(String((e as Error).message))) throw e;
    await p.request({ method: 'wallet_addEthereumChain', params: [chainParams()] });
  }
}

export async function requestAccount(p: EIP1193Provider): Promise<Address> {
  const accounts = (await p.request({ method: 'eth_requestAccounts' })) as Address[];
  const a = accounts[0];
  if (!a) throw new Error('no account returned by the wallet');
  return a;
}

export function walletClient(p: EIP1193Provider, account: Address): WalletClient {
  return createWalletClient({ account, chain: robinhoodChain, transport: custom(p) });
}

/** Subscribes to account / chain changes; returns an unsubscribe. */
export function onWalletChange(p: EIP1193Provider, cb: (s: Partial<WalletState>) => void): () => void {
  const onAccounts = (accounts: unknown) => cb({ address: ((accounts as Address[])[0] ?? null) });
  const onChain = (id: unknown) => cb({ chainId: Number(id) });
  p.on('accountsChanged', onAccounts);
  p.on('chainChanged', onChain);
  return () => { p.removeListener('accountsChanged', onAccounts); p.removeListener('chainChanged', onChain); };
}

/** viem wraps wallet and RPC errors in long reports; the first line and the revert reason are what a person needs. */
export function shortError(e: unknown): string {
  const x = e as { shortMessage?: string; metaMessages?: string[]; message?: string; code?: number };
  if (x.code === 4001 || /rejected|denied/i.test(x.shortMessage ?? '')) return 'Rejected in the wallet.';
  const reason = x.metaMessages?.find((m) => /^Error: |reason:/.test(m));
  return [x.shortMessage ?? x.message ?? String(e), reason].filter(Boolean).join(' — ');
}
