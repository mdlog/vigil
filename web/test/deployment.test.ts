import { describe, expect, it } from 'vitest';
import { ADDR, CHAIN_ID, CONTRACT_ORDER, MARKET_ID, RPC_URL } from '../src/deployment';

describe('deployment manifest', () => {
  it('targets Robinhood Chain testnet', () => {
    expect(CHAIN_ID).toBe(46630);
    expect(RPC_URL).toBe('https://rpc.testnet.chain.robinhood.com');
  });
  it('has a checksummed address for all 13 contracts (v3: 12 deployed + the Paxos USDG)', () => {
    expect(CONTRACT_ORDER).toHaveLength(13);
    for (const name of CONTRACT_ORDER) expect(ADDR[name]).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(ADDR.VigilOracle).toBe('0xF2BeeE25008E34d5bf6CF948F3F1fd1BaEa1a865');
    expect(ADDR.USDG).toBe('0x7E955252E15c84f5768B83c41a71F9eba181802F');
    expect(CONTRACT_ORDER).not.toContain('MockUSDG');
  });
  it('exposes the market id', () => {
    expect(MARKET_ID).toBe('0xf44a2ac2f5718ff156ef10a378414d99ae20842c815198f88e3b752dd64d7f1a');
  });
});
