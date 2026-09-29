import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarketPicker } from '../src/dashboard/MarketPicker';
import { MARKETS, marketOf } from '../src/deployment';

describe('market picker', () => {
  it('offers every market and marks the chosen one', () => {
    const html = renderToStaticMarkup(<MarketPicker market={marketOf('AMD')} onPick={() => {}} />);
    for (const m of MARKETS) expect(html).toContain(`data-market="${m.symbol}"`);
    expect(html).toMatch(/data-market="AMD"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-market="AMD"/);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
  });
});
