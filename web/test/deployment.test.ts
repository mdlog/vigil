import { describe, expect, it } from 'vitest';
import { ADDR, CHAIN_ID, CONTRACT_ORDER, MARKET_ID, RPC_URL, SYMBOL } from '../src/deployment';

describe('deployment manifest', () => {
  it('targets Robinhood Chain testnet', () => {
    expect(CHAIN_ID).toBe(46630);
    expect(RPC_URL).toBe('https://rpc.testnet.chain.robinhood.com');
  });
  it('has a checksummed address for all 13 contracts (v4: 11 deployed + Paxos USDG + Robinhood TSLA)', () => {
    expect(CONTRACT_ORDER).toHaveLength(13);
    for (const name of CONTRACT_ORDER) expect(ADDR[name]).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(ADDR.VigilOracle).toBe('0x79DA01DB22808E3A7397B788F171a7647b1bEf8f');
    expect(ADDR.USDG).toBe('0x7E955252E15c84f5768B83c41a71F9eba181802F');
    expect(ADDR.StockToken).toBe('0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E');
    expect(SYMBOL).toBe('TSLA');
    expect(CONTRACT_ORDER).not.toContain('MockUSDG');
    expect(CONTRACT_ORDER).not.toContain('MockStockToken');
  });
  it('exposes the market id', () => {
    expect(MARKET_ID).toBe('0x165f9db8f5e1d9982a35dfaadb3f944cf747970c8f819f16f10105f5c7eb6e04');
  });
});
