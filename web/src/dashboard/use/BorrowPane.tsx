import { useState } from 'react';
import type { Snapshot } from '../../chain/snapshot';
import { SYMBOL } from '../../deployment';
import type { WalletApi } from '../../hooks/useWallet';
import { addCollateral, borrow, repay, validateAmount, withdrawCollateral } from '../../tx/actions';
import { borrowPreview, borrowTiles, fieldLimits } from '../../tx/view';
import { ActionButton, Field, Tile } from './atoms';

export function BorrowPane({ w, snapshot }: { w: WalletApi; snapshot: Snapshot | null }) {
  const [addIn, setAddIn] = useState('');
  const [borrowIn, setBorrowIn] = useState('');
  const [repayIn, setRepayIn] = useState('');
  const [remIn, setRemIn] = useState('');
  const a = w.account;
  const lltv = w.params?.lltv ?? null;
  const price = snapshot?.price ?? null;
  const lim = a ? fieldLimits(a, price, lltv) : null;
  const t = borrowTiles(a, snapshot, lltv, SYMBOL);

  const onAdd = async () => {
    if (!a) return;
    const v = validateAmount(addIn, 18, a.stock, SYMBOL);
    if (!v.ok) return w.say(v.error, 'err');
    await w.run((ctx) => addCollateral(ctx, v.value));
    setAddIn('');
  };
  const onBorrow = async () => {
    if (!a || !lim || !w.params || !snapshot) return;
    if (snapshot.price === null) return w.say('The oracle is not pricing right now (stale feed or corporate action) — borrowing is paused.', 'err');
    const v = validateAmount(borrowIn, 6, lim.borrow.limit ?? 0n, 'USDG');
    if (!v.ok) return w.say(v.error, 'err');
    await w.run((ctx) => borrow(ctx, v.value));
    setBorrowIn('');
  };
  const onRepay = async () => {
    if (!a) return;
    const v = validateAmount(repayIn, 6, a.debt, 'USDG');
    if (!v.ok) return w.say(v.error, 'err');
    await w.run((ctx) => repay(ctx, a, v.value));
    setRepayIn('');
  };
  const onRemove = async () => {
    if (!a) return;
    const v = validateAmount(remIn, 18, a.collateral, SYMBOL);
    if (!v.ok) return w.say(v.error, 'err');
    await w.run((ctx) => withdrawCollateral(ctx, v.value));
    setRemIn('');
  };

  return (
    <>
      <div className="use-grid">
        <Tile kicker="Collateral" view={t.collateral} />
        <Tile kicker="Debt" view={t.debt} />
        <Tile kicker={t.ltvLabel} view={t.ltv} />
        <Tile kicker="Borrowable now" view={t.room} />
      </div>
      <div className="forms">
        <div className="form">
          <Field label="Add collateral" unit={SYMBOL} decimals={18} value={addIn} onChange={setAddIn} max={lim?.addCollateral.button ?? null} />
          <ActionButton ready={w.ready} onClick={onAdd}>Add collateral</ActionButton>
          <p className="muted">Posts {SYMBOL} to Morpho as collateral.</p>
        </div>
        <div className="form">
          <Field label="Borrow" unit="USDG" decimals={6} value={borrowIn} onChange={setBorrowIn} max={lim?.borrow.button ?? null} />
          <ActionButton ready={w.ready} onClick={onBorrow}>Borrow</ActionButton>
          <p className="muted">{borrowPreview(borrowIn, a, price, lltv)}</p>
        </div>
        <div className="form">
          <Field label="Repay" unit="USDG" decimals={6} value={repayIn} onChange={setRepayIn} max={lim?.repay.button ?? null} />
          <ActionButton ready={w.ready} onClick={onRepay}>Repay</ActionButton>
          <p className="muted">max repays the whole debt by shares, so no dust is left.</p>
        </div>
        <div className="form">
          <Field label="Withdraw collateral" unit={SYMBOL} decimals={18} value={remIn} onChange={setRemIn} max={lim?.withdrawCollateral.button ?? null} />
          <ActionButton ready={w.ready} onClick={onRemove}>Withdraw collateral</ActionButton>
          <p className="muted">Only what keeps the position healthy at the oracle price.</p>
        </div>
      </div>
    </>
  );
}
