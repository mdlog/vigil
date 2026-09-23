import { useState } from 'react';
import type { Snapshot } from '../../chain/snapshot';
import { IS_TESTNET, NETWORK_NAME, SYMBOL, explorerTx } from '../../deployment';
import type { WalletApi } from '../../hooks/useWallet';
import { balancesLine } from '../../tx/view';
import { shortAddr } from '../../ui/format';
import { BackstopPane } from '../use/BackstopPane';
import { BorrowPane } from '../use/BorrowPane';
import { LendPane } from '../use/LendPane';
import { MemberPane } from '../use/MemberPane';

const PANES = ['Lend', 'Borrow', 'Member', 'Backstop'] as const;
type Pane = (typeof PANES)[number];

/** Lend, borrow, join, back the vault — from the visitor's own wallet, against the contracts the other tabs read. */
export function UseIt({ wallet: w, snapshot, nowMs }: { wallet: WalletApi; snapshot: Snapshot | null; nowMs: number }) {
  const [pane, setPane] = useState<Pane>('Lend');
  const connected = w.address !== null;
  const hidden = (p: Pane) => (pane === p ? 'pane' : 'pane hidden');
  return (
    <section className="panel use-panel" id="use">
      <div className="panel-heading">
        <div><span className="panel-eyebrow">04 / USE IT</span><h3>Lend, borrow, join, back the vault — from your wallet.</h3></div>
        <span className="lltv-badge">{IS_TESTNET ? 'TESTNET FUNDS' : 'MAINNET'}</span>
      </div>
      <p className="use-lede">Against the same contracts the rest of this dashboard reads. Every write is simulated first, so a revert shows up as its reason instead of a failed transaction.</p>
      <div className="wallet-bar">
        {connected && <span className={w.onChain ? 'wallet-badge on' : 'wallet-badge off'}><i /> {shortAddr(w.address!)} · {w.onChain ? NETWORK_NAME : `chain ${w.chainId} — switch with the button at the top right`}</span>}
        <span className="balances">
          {w.account ? balancesLine(w.account, SYMBOL) : connected ? 'reading the account…' : 'Connect a wallet with the button at the top right to see balances and act. Every other tab stays readable without one.'}
        </span>
      </div>
      {IS_TESTNET && (
        <p className="faucets">
          Testnet funds: <a href="https://faucet.paxos.com/" target="_blank" rel="noreferrer">USDG from Paxos ↗</a> · <a href="https://faucet.testnet.chain.robinhood.com/" target="_blank" rel="noreferrer">{SYMBOL} and ETH from Robinhood ↗</a>
        </p>
      )}
      <div className="use-tabs" role="tablist" aria-label="Actions">
        {PANES.map((p) => (
          <button key={p} type="button" role="tab" aria-selected={pane === p} className={pane === p ? 'active' : undefined} onClick={() => setPane(p)}>{p}</button>
        ))}
      </div>
      <div className={hidden('Lend')} role="tabpanel"><LendPane w={w} /></div>
      <div className={hidden('Borrow')} role="tabpanel"><BorrowPane w={w} snapshot={snapshot} /></div>
      <div className={hidden('Member')} role="tabpanel"><MemberPane w={w} /></div>
      <div className={hidden('Backstop')} role="tabpanel"><BackstopPane w={w} snapshot={snapshot} nowMs={nowMs} /></div>
      {w.status && (
        <p className={`tx-status ${w.status.kind}`} role="status" data-done={w.status.done ? '1' : undefined}>
          {w.status.text}
          {w.status.hash && <a href={explorerTx(w.status.hash)} target="_blank" rel="noreferrer"> view ↗</a>}
        </p>
      )}
    </section>
  );
}
