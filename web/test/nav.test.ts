import { describe, expect, it } from 'vitest';
import { TAB_LABEL, hashOf, legacyDashboardUrl, tabFromHash } from '../src/nav';

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
