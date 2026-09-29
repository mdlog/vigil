import { describe, expect, it } from 'vitest';
import { TAB_LABEL, hashOf, legacyDashboardUrl, routeFromHash, tabFromHash } from '../src/nav';

describe('dashboard tab in the URL hash', () => {
  it('maps known hashes, falls back to overview', () => {
    expect(tabFromHash('#use-it')).toBe('use-it');
    expect(tabFromHash('#market-risk')).toBe('market-risk');
    expect(tabFromHash('#contracts')).toBe('contracts');
    expect(tabFromHash('')).toBe('overview');
    expect(tabFromHash('#')).toBe('overview');
    expect(tabFromHash('#price')).toBe('overview');
  });
  it('round-trips and labels every tab', () => {
    expect(hashOf('use-it')).toBe('#use-it');
    expect(tabFromHash(hashOf('market-risk'))).toBe('market-risk');
    expect(TAB_LABEL['use-it']).toBe('Use it');
  });
});

describe('links from before the landing page', () => {
  it('sends ?poll= and ?rpc= to the dashboard with the query and hash kept', () => {
    expect(legacyDashboardUrl({ pathname: '/vigil/', search: '?poll=4000', hash: '' })).toBe('/vigil/dashboard/?poll=4000');
    expect(legacyDashboardUrl({ pathname: '/vigil/index.html', search: '?rpc=http%3A%2F%2F127.0.0.1%3A8546&poll=3000', hash: '#use-it' }))
      .toBe('/vigil/dashboard/?rpc=http%3A%2F%2F127.0.0.1%3A8546&poll=3000#use-it');
    expect(legacyDashboardUrl({ pathname: '/vigil', search: '?poll=2000', hash: '' })).toBe('/vigil/dashboard/?poll=2000');
  });
  it('leaves every other landing URL alone', () => {
    expect(legacyDashboardUrl({ pathname: '/vigil/', search: '', hash: '' })).toBeNull();
    expect(legacyDashboardUrl({ pathname: '/vigil/', search: '?utm_source=hackquest', hash: '#faq' })).toBeNull();
  });
});

describe('market in the URL hash', () => {
  it('reads ?m= after the tab, upper-cased', () => {
    expect(routeFromHash('#overview?m=AMD')).toEqual({ tab: 'overview', market: 'AMD' });
    expect(routeFromHash('#use-it?m=amd')).toEqual({ tab: 'use-it', market: 'AMD' });
    expect(routeFromHash('#market-risk')).toEqual({ tab: 'market-risk', market: null });
    expect(routeFromHash('#?m=PLTR')).toEqual({ tab: 'overview', market: 'PLTR' });
    expect(routeFromHash('')).toEqual({ tab: 'overview', market: null });
  });
  it('keeps old tab-only links and writes m only when given', () => {
    expect(tabFromHash('#use-it?m=NFLX')).toBe('use-it');
    expect(hashOf('use-it')).toBe('#use-it');
    expect(hashOf('use-it', null)).toBe('#use-it');
    expect(hashOf('contracts', 'AMZN')).toBe('#contracts?m=AMZN');
    expect(routeFromHash(hashOf('overview', 'AMD'))).toEqual({ tab: 'overview', market: 'AMD' });
  });
});
