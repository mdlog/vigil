import { useEffect, useState } from 'react';
import { client } from '../../chain/client';
import { shortError } from '../../chain/wallet';
import { ADDR, LEGACY_MARKET_ID } from '../../deployment';
import type { WalletApi } from '../../hooks/useWallet';
import { USDG, isMarketId, migrate, migratePrecheck, readLegacy, settleLegacy, supply, validateAmount, withdraw, type Legacy } from '../../tx/actions';
import { MIGRATE_HINT, describeLegacy, fieldLimits, lendTile } from '../../tx/view';
import { ActionButton, Field, Tile } from './atoms';

export function LendPane({ w }: { w: WalletApi }) {
  const [supplyIn, setSupplyIn] = useState('');
  const [withdrawIn, setWithdrawIn] = useState('');
  const [marketId, setMarketId] = useState<string>(LEGACY_MARKET_ID ?? '');
  const [legacyInfo, setLegacyInfo] = useState(MIGRATE_HINT);
  const [legacyTick, setLegacyTick] = useState(0);
  const a = w.account;
  const lim = a ? fieldLimits(a, null, w.params?.lltv ?? null) : null;

  // describe the position in the market being migrated from, whenever the id, the wallet or the account changes
  useEffect(() => {
    const id = marketId.trim();
    if (!w.address || !isMarketId(id)) {
      setLegacyInfo(MIGRATE_HINT);
      return;
    }
    let current = true;
    readLegacy(client, w.address, id)
      .then((l) => { if (current) setLegacyInfo(describeLegacy(l, USDG)); })
      .catch((e: unknown) => { if (current) setLegacyInfo(shortError(e)); });
    return () => { current = false; };
  }, [marketId, w.address, a, legacyTick]);

  const onSupply = async () => {
    if (!a) return;
    const v = validateAmount(supplyIn, 6, a.usdg, 'USDG');
    if (!v.ok) return w.say(v.error, 'err');
    await w.run((ctx) => supply(ctx, v.value));
    setSupplyIn('');
  };
  const onWithdraw = async () => {
    if (!a) return;
    const v = validateAmount(withdrawIn, 6, a.supplied, 'USDG');
    if (!v.ok) return w.say(v.error, 'err');
    await w.run((ctx) => withdraw(ctx, a, v.value));
    setWithdrawIn('');
  };
  const onMigrate = async () => {
    const me = w.address;
    if (!a || !me || !ADDR.VigilMigrator) return;
    const id = marketId.trim();
    if (!isMarketId(id)) return w.say('Enter a 32-byte market id.', 'err');
    let l: Legacy | null;
    try {
      l = await readLegacy(client, me, id);
    } catch (e) {
      return w.say(shortError(e), 'err');
    }
    const why = migratePrecheck(l);
    if (why !== null || l === null) return w.say(why ?? 'No market with that id on this Morpho.', 'err');
    const from = l;
    await w.run((ctx) => migrate(ctx, id, from));
    await settleLegacy(client, me, id, from.shares); // public RPCs lag a block behind the receipt
    setLegacyTick((t) => t + 1);
  };

  return (
    <>
      <div className="use-grid"><Tile kicker="Your supply" view={lendTile(a)} /></div>
      <div className="forms">
        <div className="form">
          <Field label="Supply" unit="USDG" decimals={6} value={supplyIn} onChange={setSupplyIn} max={lim?.supply.button ?? null} />
          <ActionButton ready={w.ready} onClick={onSupply}>Supply</ActionButton>
          <p className="muted">Lends USDG to the Morpho market. Borrowers are priced at the session-aware oracle; members’ shortfalls are covered by the backstop.</p>
        </div>
        <div className="form">
          <Field label="Withdraw" unit="USDG" decimals={6} value={withdrawIn} onChange={setWithdrawIn} max={lim?.withdraw.button ?? null} />
          <ActionButton ready={w.ready} onClick={onWithdraw}>Withdraw</ActionButton>
          <p className="muted">Withdraw any time while the market has liquidity.</p>
        </div>
        {ADDR.VigilMigrator && (
          <div className="form">
            <label className="field">
              <span className="field-label">Migrate from another market</span>
              <span className="field-row"><input className="amount" type="text" placeholder="0x… market id" spellCheck={false} aria-label="Market id to migrate from" value={marketId} onChange={(e) => setMarketId(e.target.value)} /></span>
            </label>
            <ActionButton ready={w.ready} onClick={onMigrate}>Migrate to the Vigil market</ActionButton>
            <p className="muted">{legacyInfo}</p>
          </div>
        )}
      </div>
    </>
  );
}
