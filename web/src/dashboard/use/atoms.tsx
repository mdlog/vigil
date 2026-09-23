import type { ReactNode } from 'react';
import { formatUnits } from 'viem';
import type { TileView } from '../../tx/view';

/** An amount field: label, input, unit and — when there is one — a max button. The class names are what the smoke test finds. */
export function Field(props: { label: string; unit: string; decimals: number; value: string; onChange: (v: string) => void; max: bigint | null }) {
  const { label, unit, decimals, value, onChange, max } = props;
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-row">
        <input className="amount" type="text" inputMode="decimal" placeholder="0.00" aria-label={`${label} in ${unit}`} value={value} onChange={(e) => onChange(e.target.value)} />
        <span className="unit">{unit}</span>
        {max !== null && <button className="max-btn" type="button" onClick={() => onChange(formatUnits(max, decimals))}>max</button>}
      </span>
    </label>
  );
}

export function Tile({ kicker, view }: { kicker: string; view: TileView }) {
  return (
    <div className="tile">
      <p className="kicker">{kicker}</p>
      <p className={view.warn ? 'big warn' : 'big'}>{view.value}</p>
      <p className="muted">{view.note}</p>
    </div>
  );
}

export function ActionButton({ ready, onClick, children, ghost = false }: { ready: boolean; onClick: () => unknown; children: ReactNode; ghost?: boolean }) {
  return <button className={ghost ? 'use-btn ghost' : 'use-btn'} type="button" disabled={!ready} onClick={() => void onClick()}>{children}</button>;
}
