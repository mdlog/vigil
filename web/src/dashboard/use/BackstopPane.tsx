import { useState } from 'react';
import type { Snapshot } from '../../chain/snapshot';
import type { WalletApi } from '../../hooks/useWallet';
import { claim, deposit, requestWithdraw, validateAmount } from '../../tx/actions';
import { usd } from '../../tx/units';
import { backstopTiles, fieldLimits, requestStatus } from '../../tx/view';
import { ActionButton, Field, Tile } from './atoms';

export function BackstopPane({ w, snapshot, nowMs }: { w: WalletApi; snapshot: Snapshot | null; nowMs: number }) {
  const [depIn, setDepIn] = useState('');
  const [reqIn, setReqIn] = useState('');
  const a = w.account;
  const lim = a ? fieldLimits(a, null, null) : null;
  const t = backstopTiles(a, snapshot);
  const marketOpen = snapshot ? snapshot.calRegime === 0 : false;
  const nowSec = Math.floor(nowMs / 1000);

  const onDeposit = async () => {
    if (!a) return;
    const v = validateAmount(depIn, 6, a.usdg, 'USDG');
    if (!v.ok) return w.say(v.error, 'err');
    await w.run((ctx) => deposit(ctx, v.value));
    setDepIn('');
  };
  const onRequest = async () => {
    if (!a) return;
    const v = validateAmount(reqIn, 6, a.vgAssets, 'USDG');
    if (!v.ok) return w.say(v.error, 'err');
    await w.run((ctx) => requestWithdraw(ctx, a, v.value));
    setReqIn('');
  };

  return (
    <>
      <div className="use-grid">
        <Tile kicker="Your backstop deposit" view={t.deposit} />
        <Tile kicker="Vault" view={t.vault} />
      </div>
      <div className="forms">
        <div className="form">
          <Field label="Deposit" unit="USDG" decimals={6} value={depIn} onChange={setDepIn} max={lim?.deposit.button ?? null} />
          <ActionButton ready={w.ready} onClick={onDeposit}>Deposit</ActionButton>
          <p className="muted">First-loss: deposits earn the premiums and pay members’ shortfalls up to the coverage cap.</p>
        </div>
        <div className="form">
          <Field label="Request withdrawal" unit="USDG" decimals={6} value={reqIn} onChange={setReqIn} max={lim?.request.button ?? null} />
          <ActionButton ready={w.ready} onClick={onRequest}>Request</ActionButton>
          <p className="muted">Exit is request → 7-day cooldown → claim during MARKET. The request escrows shares, so what you receive is their value at claim time.</p>
        </div>
      </div>
      {w.requests.length > 0 && (
        <div className="requests">
          <table>
            <thead><tr><th>Request</th><th>Value now</th><th>Ready</th><th>Status</th><th /></tr></thead>
            <tbody>
              {w.requests.map((r) => {
                const st = requestStatus(r, nowSec, marketOpen);
                return (
                  <tr key={String(r.id)}>
                    <td className="mono">#{String(r.id)}</td>
                    <td className="mono">≈ {usd(r.assetsNow)} USDG</td>
                    <td className="mono">{new Date(r.readyAt * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC</td>
                    <td>{st.text}</td>
                    <td><button className="use-btn ghost" type="button" disabled={!st.claimable || !w.ready} onClick={() => void w.run((ctx) => claim(ctx, r.id))}>Claim</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
