import { MARKETS, type Market } from '../deployment';

/** One button per market of the deployment; the choice lives in the URL hash (?m=). Nothing for a one-market deployment. */
export function MarketPicker({ market, onPick }: { market: Market; onPick: (symbol: string) => void }) {
  if (MARKETS.length < 2) return null;
  return (
    <div className="market-picker" role="tablist" aria-label="Market">
      {MARKETS.map((m) => (
        <button key={m.symbol} type="button" role="tab" data-market={m.symbol} aria-selected={m.id === market.id}
          className={m.id === market.id ? 'active' : undefined} onClick={() => onPick(m.symbol)}>{m.symbol}</button>
      ))}
    </div>
  );
}
