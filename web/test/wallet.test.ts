import { describe, expect, it } from 'vitest';
import type { EIP1193Provider } from 'viem';
import { authorizedAccount, chainParams, shortError } from '../src/chain/wallet';

describe('wallet helpers', () => {
  it('builds wallet_addEthereumChain params for the deployment', () => {
    const p = chainParams(46630, 'Robinhood Chain testnet', 'https://rpc.testnet.chain.robinhood.com', 'https://explorer.testnet.chain.robinhood.com');
    expect(p.chainId).toBe('0xb626');
    expect(p.rpcUrls).toEqual(['https://rpc.testnet.chain.robinhood.com']);
    expect(p.nativeCurrency.decimals).toBe(18);
  });
  it('shortens viem errors to the reason', () => {
    expect(shortError({ code: 4001, shortMessage: 'User rejected the request.' })).toBe('Rejected in the wallet.');
    expect(shortError({ shortMessage: 'The contract function "topUp" reverted.', metaMessages: ['Error: ReserveBreach()', 'Contract Call:'] }))
      .toBe('The contract function "topUp" reverted. — Error: ReserveBreach()');
    expect(shortError(new Error('plain'))).toBe('plain');
  });
});

describe('authorizedAccount (reconnect on load)', () => {
  const wallet = (accounts: string[]) => {
    const calls: string[] = [];
    const p = { request: async ({ method }: { method: string }) => { calls.push(method); return accounts; } } as unknown as EIP1193Provider;
    return { p, calls };
  };
  it('returns the account the site is already authorised for, without a prompt', async () => {
    const { p, calls } = wallet(['0x00000000000000000000000000000000000000aa', '0x00000000000000000000000000000000000000bb']);
    expect(await authorizedAccount(p)).toBe('0x00000000000000000000000000000000000000aa');
    expect(calls).toEqual(['eth_accounts']); // never eth_requestAccounts: no popup on page load
  });
  it('returns null when the wallet has not authorised the site', async () => {
    expect(await authorizedAccount(wallet([]).p)).toBeNull();
  });
});
