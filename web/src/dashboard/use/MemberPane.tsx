import { useState } from 'react';
import type { WalletApi } from '../../hooks/useWallet';
import { join, leave, topUp, validateAmount, withdrawUnused } from '../../tx/actions';
import { fieldLimits, memberTiles } from '../../tx/view';
import { ActionButton, Field, Tile } from './atoms';

export function MemberPane({ w }: { w: WalletApi }) {
  const [topIn, setTopIn] = useState('');
  const [unusedIn, setUnusedIn] = useState('');
  const a = w.account;
  const lim = a ? fieldLimits(a, null, null) : null;
  const t = memberTiles(a);

  const onTopUp = async () => {
    if (!a) return;
    const v = validateAmount(topIn, 6, a.usdg, 'USDG');
    if (!v.ok) return w.say(v.error, 'err');
    await w.run((ctx) => topUp(ctx, v.value));
    setTopIn('');
  };
  const onUnused = async () => {
    if (!a || !lim) return;
    const v = validateAmount(unusedIn, 6, lim.withdrawUnused.limit, 'USDG');
    if (!v.ok) return w.say(v.error, 'err');
    await w.run((ctx) => withdrawUnused(ctx, v.value));
    setUnusedIn('');
  };

  return (
    <>
      <div className="use-grid">
        <Tile kicker="Membership" view={t.membership} />
        <Tile kicker="Premium escrow" view={t.escrow} />
      </div>
      <div className="forms">
        <div className="form">
          <span className="field-label">Step 1 · authorisation</span>
          <div className="btn-row">
            {a?.authorized
              ? <ActionButton ready={w.ready} onClick={() => w.run((ctx) => leave(ctx))} ghost>Leave (revoke)</ActionButton>
              : <ActionButton ready={w.ready} onClick={() => w.run((ctx) => join(ctx))}>Join — authorise the soft unwind</ActionButton>}
          </div>
          <p className="muted">{t.joinNote}</p>
        </div>
        <div className="form">
          <Field label="Top up escrow" unit="USDG" decimals={6} value={topIn} onChange={setTopIn} max={lim?.topUp.button ?? null} />
          <ActionButton ready={w.ready} onClick={onTopUp}>Top up</ActionButton>
          <p className="muted">Step 2 · escrow. A member keeps at least the 7-day reserve on top of what is owed; the premium is only charged while you hold leverage through a closure.</p>
        </div>
        <div className="form">
          <Field label="Withdraw unused" unit="USDG" decimals={6} value={unusedIn} onChange={setUnusedIn} max={lim?.withdrawUnused.button ?? null} />
          <ActionButton ready={w.ready} onClick={onUnused}>Withdraw unused</ActionButton>
          <p className="muted">Anything above the reserve can be taken back at any time.</p>
        </div>
      </div>
    </>
  );
}
