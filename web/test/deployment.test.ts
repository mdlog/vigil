import { describe, expect, it } from 'vitest';
import { ADDR, CHAIN_ID, CONTRACT_ORDER, MARKET_ID, RPC_URL } from '../src/deployment';

describe('deployment manifest', () => {
  it('targets Robinhood Chain testnet', () => {
    expect(CHAIN_ID).toBe(46630);
    expect(RPC_URL).toBe('https://rpc.testnet.chain.robinhood.com');
  });
  it('has a checksummed address for all 13 contracts', () => {
    for (const name of CONTRACT_ORDER) expect(ADDR[name]).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(ADDR.VigilOracle).toBe('0x445A820a0F3AeE54E43715620938e71b04a2974e');
  });
  it('exposes the market id', () => {
    expect(MARKET_ID).toBe('0x4b7339b6469bf06ff83ec7ec4baa995f2589ae7782d11b2ba6d02c2c218a5145');
  });
});
