import { describe, expect, it } from 'vitest';
import { chainParams, shortError } from '../src/chain/wallet';

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
