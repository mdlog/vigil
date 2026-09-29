import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from '../src/dashboard/Sidebar';
import { deploymentNote } from '../src/dashboard/Footer';
import { marketOf } from '../src/deployment';
import { settledStatus } from '../src/tx/view';

describe('the page chrome follows the chosen market', () => {
  it('points the sidebar explorer link at that market\'s oracle', () => {
    const amd = marketOf('AMD');
    const html = renderToStaticMarkup(<Sidebar tab="overview" onTab={() => {}} open={false} onClose={() => {}} status="live" lastOkMs={0} nowMs={0} market={amd} />);
    expect(html).toContain(`/address/${amd.oracle}`);
  });
  it('names that market\'s token in the footer note', () => {
    expect(deploymentNote('NFLX')).toContain("the collateral is Robinhood's NFLX token");
    expect(deploymentNote('NFLX')).not.toContain('TSLA');
  });
});

describe('the status line after a transaction', () => {
  const st = { text: 'Supply 10.00 USDG — confirmed in block 1.', kind: 'ok' as const, done: false };
  it('is marked done on the market it ran on', () => {
    expect(settledStatus(st, 'TSLA', 'TSLA')).toEqual({ ...st, done: true });
  });
  it('is dropped when the visitor moved to another market meanwhile', () => {
    expect(settledStatus(st, 'TSLA', 'AMD')).toBeNull();
    expect(settledStatus(null, 'TSLA', 'TSLA')).toBeNull();
  });
});
