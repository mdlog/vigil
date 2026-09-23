/** The wallet side of the "Use it" tab (ported from web/src/panels/use.ts @ 7f9d414): an injected EIP-1193 wallet kept
 *  on the deployment's chain, the account re-read after every change, and a runner that walks a builder's steps —
 *  confirm in the wallet, wait for the receipt, re-read — behind one status line that the smoke test reads. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address, EIP1193Provider, Hex } from 'viem';
import { client } from '../chain/client';
import { readAccount, readMarketParams, readRequests, type AccountState, type MarketParams, type WithdrawRequest } from '../chain/account';
import { authorizedAccount, currentChainId, ensureChain, onWalletChange, provider, requestAccount, shortError, walletClient } from '../chain/wallet';
import { CHAIN_ID, NETWORK_NAME } from '../deployment';
import type { Step, TxContext } from '../tx/actions';
import { walletReady } from '../tx/view';

export type StatusKind = 'info' | 'ok' | 'err';
export interface TxStatus { text: string; kind: StatusKind; hash?: Hex; done: boolean }

export interface WalletApi {
  address: Address | null;
  chainId: number | null;
  onChain: boolean;
  account: AccountState | null;
  requests: WithdrawRequest[];
  params: MarketParams | null;
  busy: boolean;
  ready: boolean;
  status: TxStatus | null;
  connect(): Promise<void>;
  switchChain(): Promise<void>;
  say(text: string, kind?: StatusKind): void;
  run(build: (ctx: TxContext) => Promise<Step[]>): Promise<void>;
}

export function useWallet(): WalletApi {
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [requests, setRequests] = useState<WithdrawRequest[]>([]);
  const [params, setParams] = useState<MarketParams | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<TxStatus | null>(null);
  // latest values for async code: a transaction outlives the render that started it
  const prov = useRef<EIP1193Provider | null>(null);
  const addr = useRef<Address | null>(null);
  const chain = useRef<number | null>(null);
  const par = useRef<MarketParams | null>(null);
  const busyRef = useRef(false);

  const say = useCallback((text: string, kind: StatusKind = 'info', hash?: Hex) => setStatus({ text, kind, hash, done: false }), []);

  const refresh = useCallback(async () => {
    const a = addr.current;
    if (!a) {
      setAccount(null);
      setRequests([]);
      return;
    }
    try {
      if (!par.current) {
        par.current = await readMarketParams(client);
        setParams(par.current);
      }
      const [acct, reqs] = await Promise.all([readAccount(client, a), readRequests(client, a)]);
      if (addr.current !== a) return; // the wallet switched account meanwhile
      setAccount(acct);
      setRequests(reqs);
    } catch (e) {
      say(`Could not read the account: ${shortError(e)}`, 'err');
    }
  }, [say]);

  const connect = useCallback(async () => {
    const p = provider();
    if (!p) {
      say('No wallet found — install a browser wallet (MetaMask, Rabby…) and reload.', 'err');
      return;
    }
    prov.current = p;
    try {
      const a = await requestAccount(p);
      const id = await currentChainId(p);
      addr.current = a;
      chain.current = id;
      setAddress(a);
      setChainId(id);
      setStatus(null);
      if (id !== CHAIN_ID) say(`Your wallet is on chain ${id}; this deployment is on ${NETWORK_NAME} (${CHAIN_ID}).`, 'err');
      await refresh();
    } catch (e) {
      say(shortError(e), 'err');
    }
  }, [refresh, say]);

  // A wallet that already authorised this site reconnects on load, without a prompt (eth_accounts).
  useEffect(() => {
    const p = provider();
    if (!p) return;
    let cancelled = false;
    void (async () => {
      const a = await authorizedAccount(p);
      if (cancelled || !a || addr.current) return;
      const id = await currentChainId(p);
      if (cancelled || addr.current) return;
      prov.current = p;
      addr.current = a;
      chain.current = id;
      setAddress(a);
      setChainId(id);
      await refresh();
    })().catch(() => {}); // a wallet that refuses eth_accounts simply stays disconnected
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const connected = address !== null;
  useEffect(() => {
    const p = prov.current;
    if (!p || !connected) return;
    return onWalletChange(p, (s) => {
      if (s.address !== undefined) {
        addr.current = s.address;
        setAddress(s.address);
      }
      if (s.chainId !== undefined) {
        chain.current = s.chainId;
        setChainId(s.chainId);
      }
      void refresh();
    });
  }, [connected, refresh]);

  const switchChain = useCallback(async () => {
    const p = prov.current;
    if (!p) return;
    try {
      await ensureChain(p);
      const id = await currentChainId(p);
      chain.current = id;
      setChainId(id);
      setStatus(null);
      await refresh();
    } catch (e) {
      say(shortError(e), 'err');
    }
  }, [refresh, say]);

  const run = useCallback(
    async (build: (ctx: TxContext) => Promise<Step[]>) => {
      const a = addr.current;
      const p = prov.current;
      if (!a || !p || !par.current || busyRef.current) return;
      if (chain.current !== CHAIN_ID) {
        say(`Switch the wallet to ${NETWORK_NAME} first.`, 'err');
        return;
      }
      busyRef.current = true;
      setBusy(true);
      say('Preparing…');
      try {
        const ctx: TxContext = { client, wallet: walletClient(p, a), account: a, params: par.current, say: (t) => say(t) };
        const steps = await build(ctx);
        for (const [i, s] of steps.entries()) {
          const n = steps.length > 1 ? `${i + 1}/${steps.length} ` : '';
          say(`${n}${s.label} — confirm in the wallet…`);
          const hash = await s.send();
          say(`${n}${s.label} — sent, waiting for the receipt…`, 'info', hash);
          const r = await client.waitForTransactionReceipt({ hash });
          if (r.status !== 'success') throw new Error(`${s.label} reverted on-chain`);
          say(`${n}${s.label} — confirmed in block ${r.blockNumber}.`, 'ok', hash);
        }
      } catch (e) {
        say(shortError(e), 'err');
      } finally {
        busyRef.current = false;
        setBusy(false);
        await refresh();
        setStatus((st) => (st ? { ...st, done: true } : st)); // the smoke test waits for data-done="1"
      }
    },
    [refresh, say],
  );

  return {
    address, chainId, onChain: chainId === CHAIN_ID, account, requests, params, busy, status,
    ready: walletReady({ address, account, params, chainId, busy }, CHAIN_ID),
    connect, switchChain, say, run,
  };
}
