import { describe, expect, it } from 'vitest';
import { vigilSessionOracleAbi } from '../src/abi/vigilSessionOracle';
import { vigilRiskEngineAbi } from '../src/abi/vigilRiskEngine';
import { vigilOracleAbi } from '../src/abi/vigilOracle';
import { vigilBackstopAbi } from '../src/abi/vigilBackstop';
import { morphoAbi } from '../src/abi/morpho';
import { mockFeedAbi } from '../src/abi/mockFeed';

function names(abi: readonly { type: string; name?: string }[]): string[] {
  return abi.filter((i) => i.type === 'function').map((i) => i.name!);
}

describe('generated ABIs expose every function the dashboard reads', () => {
  it('session oracle', () => {
    expect(names(vigilSessionOracleAbi)).toEqual(
      expect.arrayContaining(['regimeOf', 'closureOf', 'feedIsUsable', 'premiumIndex', 'lastPokeOf', 'configs']),
    );
  });
  it('risk engine', () => {
    expect(names(vigilRiskEngineAbi)).toEqual(
      expect.arrayContaining(['haircutBps', 'targetHaircutBps', 'surfaces', 'closureHaircutBps', 'premiumRefRatePerSecond', 'eventActive']),
    );
  });
  it('oracle', () => {
    expect(names(vigilOracleAbi)).toEqual(
      expect.arrayContaining(['price', 'unhaircutPrice', 'currentHaircutBps', 'regime', 'MARKET_HAIRCUT_CAP_BPS']),
    );
  });
  it('backstop', () => {
    expect(names(vigilBackstopAbi)).toEqual(
      expect.arrayContaining(['totalAssets', 'totalSupply', 'coverageCapOf', 'totalCovered', 'COOLDOWN']),
    );
  });
  it('morpho + feed', () => {
    expect(names(morphoAbi)).toContain('market');
    expect(names(mockFeedAbi)).toContain('latestRoundData');
  });
});
