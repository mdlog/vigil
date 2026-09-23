import { Wallet } from 'lucide-react';
import { CHAIN_ID, NETWORK_NAME } from '../deployment';
import type { WalletApi } from '../hooks/useWallet';
import { walletChip } from '../tx/view';

/** The page's one wallet control, in the top bar on every tab: Connect → Switch (foreign chain) → the address. */
export function WalletButton({ w }: { w: WalletApi }) {
  const chip = walletChip(w.address, w.chainId, CHAIN_ID, NETWORK_NAME);
  if (chip.kind === 'connect') {
    return (
      <button className="wallet-connect" type="button" onClick={() => void w.connect()}>
        <Wallet size={14} /> <span className="label-long">Connect wallet</span><span className="label-short">Connect</span>
      </button>
    );
  }
  if (chip.kind === 'switch') {
    return <button className="wallet-connect warn" type="button" onClick={() => void w.switchChain()}>{chip.label}</button>;
  }
  return <span className="wallet-chip" title={w.address ?? undefined}><i /> {chip.label}</span>;
}
