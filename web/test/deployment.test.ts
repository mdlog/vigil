import { describe, expect, it } from 'vitest';
import { ADDR, CHAIN_ID, CONTRACT_ORDER, MARKET_ID, RPC_URL } from '../src/deployment';

describe('deployment manifest', () => {
  it('targets Robinhood Chain testnet', () => {
    expect(CHAIN_ID).toBe(46630);
    expect(RPC_URL).toBe('https://rpc.testnet.chain.robinhood.com');
  });
  it('has a checksummed address for all 13 contracts', () => {
    for (const name of CONTRACT_ORDER) expect(ADDR[name]).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(ADDR.VigilOracle).toBe('0x351Ca8799D409F3BF37b147928fEE756ee96cA72');
  });
  it('exposes the market id', () => {
    expect(MARKET_ID).toBe('0x182f57bc84c43b38fb6ec7df529b9e274cd32bd833161d5df5419a126ad7265d');
  });
});
