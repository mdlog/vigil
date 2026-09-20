/** The transaction panel: lend, borrow, join as a member and back the vault from an injected wallet. Every write
 *  is simulated first (so a revert surfaces as its custom error, not as a failed transaction), sent through the
 *  wallet, awaited, and followed by a fresh read of the account. Nothing here is required to *watch* Vigil —
 *  the rest of the page stays read-only. */
import { formatUnits, type Address, type EIP1193Provider, type Hex, type WalletClient } from 'viem';
import { el, setText } from '../ui/dom';
import { ADDR, ASSET, CHAIN_ID, IS_TESTNET, MARKET_ID, NETWORK_NAME, SYMBOL, explorerTx } from '../deployment';
import { client } from '../chain/client';
import { erc20Abi } from '../abi/erc20';
import { morphoAbi } from '../abi/morpho';
import { vigilPremiumAbi } from '../abi/vigilPremium';
import { vigilBackstopAbi } from '../abi/vigilBackstop';
import { readAccount, readMarketParams, readRequests, type AccountState, type MarketParams, type WithdrawRequest } from '../chain/account';
import { collateralValue, ltvBps, maxBorrowOf, parseAmount } from '../chain/math';
import { currentChainId, ensureChain, onWalletChange, provider, requestAccount, shortError, walletClient } from '../chain/wallet';
import { fmtBps, fmtDuration, fmtUsd, shortAddr } from '../ui/format';
import type { Snapshot } from '../chain/snapshot';
import type { Panel } from './types';

const USDG = (ADDR.USDG ?? ADDR.MockUSDG) as Address;
const usd = (v: bigint, d = 2) => fmtUsd(Number(formatUnits(v, 6)), d);
const stk = (v: bigint, d = 4) => Number(formatUnits(v, 18)).toLocaleString('en-US', { maximumFractionDigits: d });

type Step = { label: string; send: () => Promise<Hex> };

interface Field { root: HTMLElement; input: HTMLInputElement; setMax: (v: bigint | null) => void; decimals: number }

function field(label: string, unit: string, decimals: number): Field {
  const input = el('input', { class: 'amount', type: 'text', inputmode: 'decimal', placeholder: '0.00', 'aria-label': `${label} in ${unit}` });
  let max: bigint | null = null;
  const maxBtn = el('button', { class: 'btn-ghost', type: 'button', text: 'max' });
  maxBtn.addEventListener('click', () => { if (max !== null) input.value = formatUnits(max, decimals); });
  const root = el('label', { class: 'field' },
    el('span', { class: 'field-label', text: label }),
    el('span', { class: 'field-row' }, input, el('span', { class: 'unit', text: unit }), maxBtn),
  );
  return { root, input, decimals, setMax: (v) => { max = v; maxBtn.classList.toggle('hidden', v === null); } };
}

function tile(label: string): { root: HTMLElement; value: HTMLElement; note: HTMLElement } {
  const value = el('p', { class: 'big', text: '—' });
  const note = el('p', { class: 'muted', text: '' });
  return { root: el('div', { class: 'tile' }, el('p', { class: 'kicker', text: label }), value, note), value, note };
}

export function createUse(): Panel {
  // ── wallet state ──
  let p: EIP1193Provider | null = null;
  let wallet: WalletClient | null = null;
  let address: Address | null = null;
  let chainId: number | null = null;
  let acct: AccountState | null = null;
  let reqs: WithdrawRequest[] = [];
  let params: MarketParams | null = null;
  let snap: Snapshot | null = null;
  let busy = false;

  // ── header row ──
  const connectBtn = el('button', { class: 'btn', type: 'button', text: 'Connect wallet' });
  const switchBtn = el('button', { class: 'btn hidden', type: 'button', text: `Switch to ${NETWORK_NAME}` });
  const who = el('span', { class: 'badge hidden' });
  const balances = el('p', { class: 'muted balances', text: '' });
  const faucets = IS_TESTNET
    ? el('p', { class: 'muted' }, 'Testnet funds: ',
        el('a', { href: 'https://faucet.paxos.com/', target: '_blank', rel: 'noopener', text: 'USDG from Paxos ↗' }), ' · ',
        el('a', { href: 'https://faucet.testnet.chain.robinhood.com/', target: '_blank', rel: 'noopener', text: `${SYMBOL} and ETH from Robinhood ↗` }))
    : null;
  const status = el('p', { class: 'tx-status hidden', role: 'status' });

  // ── tabs ──
  const TABS = ['Lend', 'Borrow', 'Member', 'Backstop'] as const;
  const panes: Record<(typeof TABS)[number], HTMLElement> = {
    Lend: el('div', { class: 'pane' }), Borrow: el('div', { class: 'pane hidden' }), Member: el('div', { class: 'pane hidden' }), Backstop: el('div', { class: 'pane hidden' }),
  };
  const tabButtons = TABS.map((t) => el('button', { class: `tab${t === 'Lend' ? ' active' : ''}`, type: 'button', role: 'tab', 'aria-selected': t === 'Lend', text: t }));
  tabButtons.forEach((b, i) => b.addEventListener('click', () => {
    tabButtons.forEach((x, j) => { x.classList.toggle('active', i === j); x.setAttribute('aria-selected', String(i === j)); });
    TABS.forEach((t, j) => panes[t].classList.toggle('hidden', i !== j));
  }));

  // ── Lend ──
  const lendTile = tile('Your supply');
  const supplyF = field('Supply', 'USDG', 6);
  const withdrawF = field('Withdraw', 'USDG', 6);
  const supplyBtn = el('button', { class: 'btn', type: 'button', text: 'Supply' });
  const withdrawBtn = el('button', { class: 'btn', type: 'button', text: 'Withdraw' });
  panes.Lend.append(
    el('div', { class: 'use-grid' }, lendTile.root),
    el('div', { class: 'forms' },
      el('div', { class: 'form' }, supplyF.root, supplyBtn, el('p', { class: 'muted', text: 'Lends USDG to the Morpho market. Borrowers are priced at the session-aware oracle; members’ shortfalls are covered by the backstop.' })),
      el('div', { class: 'form' }, withdrawF.root, withdrawBtn, el('p', { class: 'muted', text: 'Withdraw any time while the market has liquidity.' })),
    ),
  );

  // ── Borrow ──
  const collTile = tile('Collateral');
  const debtTile = tile('Debt');
  const ltvTile = tile('LTV · LLTV 86 %');
  const roomTile = tile('Borrowable now');
  const addCollF = field('Add collateral', SYMBOL, 18);
  const borrowF = field('Borrow', 'USDG', 6);
  const repayF = field('Repay', 'USDG', 6);
  const remCollF = field('Withdraw collateral', SYMBOL, 18);
  const addCollBtn = el('button', { class: 'btn', type: 'button', text: 'Add collateral' });
  const borrowBtn = el('button', { class: 'btn', type: 'button', text: 'Borrow' });
  const repayBtn = el('button', { class: 'btn', type: 'button', text: 'Repay' });
  const remCollBtn = el('button', { class: 'btn', type: 'button', text: 'Withdraw collateral' });
  const borrowPreview = el('p', { class: 'muted', text: 'Borrowing power is computed at the oracle price — the haircut in force reduces it during a closure.' });
  panes.Borrow.append(
    el('div', { class: 'use-grid' }, collTile.root, debtTile.root, ltvTile.root, roomTile.root),
    el('div', { class: 'forms' },
      el('div', { class: 'form' }, addCollF.root, addCollBtn, el('p', { class: 'muted', text: `Posts ${SYMBOL} to Morpho as collateral.` })),
      el('div', { class: 'form' }, borrowF.root, borrowBtn, borrowPreview),
      el('div', { class: 'form' }, repayF.root, repayBtn, el('p', { class: 'muted', text: 'max repays the whole debt by shares, so no dust is left.' })),
      el('div', { class: 'form' }, remCollF.root, remCollBtn, el('p', { class: 'muted', text: 'Only what keeps the position healthy at the oracle price.' })),
    ),
  );

  // ── Member ──
  const memTile = tile('Membership');
  const escTile = tile('Premium escrow');
  const joinBtn = el('button', { class: 'btn', type: 'button', text: 'Join — authorise the soft unwind' });
  const leaveBtn = el('button', { class: 'btn-ghost hidden', type: 'button', text: 'Leave (revoke)' });
  const topUpF = field('Top up escrow', 'USDG', 6);
  const unusedF = field('Withdraw unused', 'USDG', 6);
  const topUpBtn = el('button', { class: 'btn', type: 'button', text: 'Top up' });
  const unusedBtn = el('button', { class: 'btn', type: 'button', text: 'Withdraw unused' });
  const joinNote = el('p', { class: 'muted', text: '' });
  panes.Member.append(
    el('div', { class: 'use-grid' }, memTile.root, escTile.root),
    el('div', { class: 'forms' },
      el('div', { class: 'form' }, el('span', { class: 'field-label', text: 'Step 1 · authorisation' }), el('div', { class: 'btn-row' }, joinBtn, leaveBtn), joinNote),
      el('div', { class: 'form' }, topUpF.root, topUpBtn, el('p', { class: 'muted', text: 'Step 2 · escrow. A member keeps at least the 7-day reserve on top of what is owed; the premium is only charged while you hold leverage through a closure.' })),
      el('div', { class: 'form' }, unusedF.root, unusedBtn, el('p', { class: 'muted', text: 'Anything above the reserve can be taken back at any time.' })),
    ),
  );

  // ── Backstop ──
  const vgTile = tile('Your backstop deposit');
  const vaultTile = tile('Vault');
  const depositF = field('Deposit', 'USDG', 6);
  const requestF = field('Request withdrawal', 'USDG', 6);
  const depositBtn = el('button', { class: 'btn', type: 'button', text: 'Deposit' });
  const requestBtn = el('button', { class: 'btn', type: 'button', text: 'Request' });
  const reqTable = el('tbody');
  const reqWrap = el('div', { class: 'table-wrap hidden' },
    el('table', { class: 'table' }, el('thead', {}, el('tr', {}, ...['Request', 'Value now', 'Ready', 'Status', ''].map((h) => el('th', { text: h })))), reqTable));
  panes.Backstop.append(
    el('div', { class: 'use-grid' }, vgTile.root, vaultTile.root),
    el('div', { class: 'forms' },
      el('div', { class: 'form' }, depositF.root, depositBtn, el('p', { class: 'muted', text: 'First-loss: deposits earn the premiums and pay members’ shortfalls up to the coverage cap.' })),
      el('div', { class: 'form' }, requestF.root, requestBtn, el('p', { class: 'muted', text: 'Exit is request → 7-day cooldown → claim during MARKET. The request escrows shares, so what you receive is their value at claim time.' })),
    ),
    reqWrap,
  );

  const root = el('section', { class: 'panel reveal', id: 'use' },
    el('p', { class: 'kicker', text: '04 · Use it' }),
    el('p', { class: 'lede', text: 'Lend USDG, borrow against the stock token, join as a member to get the soft unwind and the cover, or back the vault — from your own wallet, against the same contracts this page reads.' }),
    el('div', { class: 'wallet-bar' }, connectBtn, switchBtn, who, balances),
    faucets,
    el('div', { class: 'tabs', role: 'tablist' }, ...tabButtons),
    ...TABS.map((t) => panes[t]),
    status,
  );

  const allButtons = [supplyBtn, withdrawBtn, addCollBtn, borrowBtn, repayBtn, remCollBtn, joinBtn, leaveBtn, topUpBtn, unusedBtn, depositBtn, requestBtn];
  const setEnabled = (on: boolean) => { for (const b of allButtons) b.disabled = !on; };

  // ── status line ──
  function say(text: string, kind: 'info' | 'ok' | 'err' = 'info', hash?: Hex) {
    status.classList.remove('hidden');
    status.className = `tx-status ${kind}`;
    status.replaceChildren(text, hash ? el('a', { href: explorerTx(hash), target: '_blank', rel: 'noopener', text: ' view ↗' }) : '');
    delete status.dataset.done; // set again once the account has been re-read after an action
  }

  // ── wallet lifecycle ──
  async function refresh() {
    if (!address) { acct = null; reqs = []; paint(); return; }
    try {
      params ??= await readMarketParams(client);
      [acct, reqs] = await Promise.all([readAccount(client, address), readRequests(client, address)]);
      buildRequests();
    } catch (e) {
      say(`Could not read the account: ${shortError(e)}`, 'err');
    }
    paint();
  }

  async function connect() {
    p = provider();
    if (!p) { say('No wallet found — install a browser wallet (MetaMask, Rabby…) and reload.', 'err'); return; }
    try {
      address = await requestAccount(p);
      chainId = await currentChainId(p);
      wallet = walletClient(p, address);
      onWalletChange(p, async (s) => {
        if (s.address !== undefined) { address = s.address; wallet = address && p ? walletClient(p, address) : null; }
        if (s.chainId !== undefined) chainId = s.chainId;
        await refresh();
      });
      status.classList.add('hidden');
      if (chainId !== CHAIN_ID) { say(`Your wallet is on chain ${chainId}; this deployment is on ${NETWORK_NAME} (${CHAIN_ID}).`, 'err'); }
      await refresh();
    } catch (e) { say(shortError(e), 'err'); }
  }
  connectBtn.addEventListener('click', () => void connect());
  switchBtn.addEventListener('click', async () => {
    if (!p) return;
    try { await ensureChain(p); chainId = await currentChainId(p); status.classList.add('hidden'); await refresh(); } catch (e) { say(shortError(e), 'err'); }
  });

  // ── transaction runner ──
  async function run(build: () => Promise<Step[]>) {
    if (!wallet || !address || busy) return;
    if (chainId !== CHAIN_ID) { say(`Switch the wallet to ${NETWORK_NAME} first.`, 'err'); return; }
    busy = true; setEnabled(false);
    say('Preparing…');
    try {
      const steps = await build();
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
      busy = false; setEnabled(true);
      await refresh();
      status.dataset.done = '1';
    }
  }

  type Write = { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] };
  const write = (w: Write) => async (): Promise<Hex> => {
    const { request } = await client.simulateContract({ ...w, account: address!, abi: w.abi as never, args: w.args as never } as never);
    return wallet!.writeContract(request as never);
  };
  const approveStep = async (token: Address, spender: Address, amount: bigint, what: string): Promise<Step[]> => {
    const allowance = await client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [address!, spender] });
    if (allowance >= amount) return [];
    return [{ label: `Approve ${what}`, send: write({ address: token, abi: erc20Abi, functionName: 'approve', args: [spender, amount] }) }];
  };
  const morpho = (functionName: string, args: readonly unknown[]): Write => ({ address: ADDR.Morpho, abi: morphoAbi, functionName, args });
  const premium = (functionName: string, args: readonly unknown[]): Write => ({ address: ADDR.VigilPremium, abi: vigilPremiumAbi, functionName, args });
  const backstop = (functionName: string, args: readonly unknown[]): Write => ({ address: ADDR.VigilBackstop, abi: vigilBackstopAbi, functionName, args });
  const amountOf = (f: Field, max: bigint | null, what: string): bigint | null => {
    const v = parseAmount(f.input.value, f.decimals);
    if (v === null) { say(`Enter a positive ${what} amount with at most ${f.decimals} decimals.`, 'err'); return null; }
    if (max !== null && v > max) { say(`That is more than the ${formatUnits(max, f.decimals)} ${what} available.`, 'err'); return null; }
    return v;
  };
  const NONE = '0x' as Hex;

  // Lend
  supplyBtn.addEventListener('click', async () => {
    if (!acct || !params) return;
    const v = amountOf(supplyF, acct.usdg, 'USDG'); if (v === null) return;
    await run(async () => [...(await approveStep(USDG, ADDR.Morpho, v, 'USDG for Morpho')), { label: `Supply ${usd(v)} USDG`, send: write(morpho('supply', [params, v, 0n, address, NONE])) }]);
    supplyF.input.value = '';
  });
  withdrawBtn.addEventListener('click', async () => {
    if (!acct || !params) return;
    const a = acct;
    const v = amountOf(withdrawF, a.supplied, 'USDG'); if (v === null) return;
    const all = v === a.supplied; // by shares, so the position closes exactly
    await run(async () => [{ label: `Withdraw ${usd(v)} USDG`, send: write(morpho('withdraw', [params, all ? 0n : v, all ? a.supplyShares : 0n, address, address])) }]);
    withdrawF.input.value = '';
  });

  // Borrow
  addCollBtn.addEventListener('click', async () => {
    if (!acct || !params) return;
    const v = amountOf(addCollF, acct.stock, SYMBOL); if (v === null) return;
    await run(async () => [...(await approveStep(ASSET, ADDR.Morpho, v, `${SYMBOL} for Morpho`)), { label: `Add ${stk(v)} ${SYMBOL} collateral`, send: write(morpho('supplyCollateral', [params, v, address, NONE])) }]);
    addCollF.input.value = '';
  });
  borrowBtn.addEventListener('click', async () => {
    if (!acct || !params || !snap) return;
    if (snap.price === null) { say('The oracle is not pricing right now (stale feed or corporate action) — borrowing is paused.', 'err'); return; }
    const room = maxBorrowOf(acct.collateral, snap.price, params.lltv) - acct.debt;
    const v = amountOf(borrowF, room > 0n ? room : 0n, 'USDG'); if (v === null) return;
    await run(async () => [{ label: `Borrow ${usd(v)} USDG`, send: write(morpho('borrow', [params, v, 0n, address, address])) }]);
    borrowF.input.value = '';
    previewBorrow();
  });
  repayBtn.addEventListener('click', async () => {
    if (!acct || !params) return;
    const a = acct;
    const v = amountOf(repayF, a.debt, 'USDG'); if (v === null) return;
    const all = v === a.debt;
    await run(async () => [...(await approveStep(USDG, ADDR.Morpho, v, 'USDG for Morpho')), { label: `Repay ${usd(v)} USDG`, send: write(morpho('repay', [params, all ? 0n : v, all ? a.borrowShares : 0n, address, NONE])) }]);
    repayF.input.value = '';
  });
  remCollBtn.addEventListener('click', async () => {
    if (!acct || !params) return;
    const v = amountOf(remCollF, acct.collateral, SYMBOL); if (v === null) return;
    await run(async () => [{ label: `Withdraw ${stk(v)} ${SYMBOL}`, send: write(morpho('withdrawCollateral', [params, v, address, address])) }]);
    remCollF.input.value = '';
  });

  // Member
  joinBtn.addEventListener('click', async () => {
    if (!acct) return;
    await run(async () => [{ label: 'Authorise VigilPreLiquidation on your Morpho position', send: write(morpho('setAuthorization', [ADDR.VigilPreLiquidation, true])) }]);
  });
  leaveBtn.addEventListener('click', async () => {
    if (!acct) return;
    await run(async () => [{ label: 'Revoke VigilPreLiquidation', send: write(morpho('setAuthorization', [ADDR.VigilPreLiquidation, false])) }]);
  });
  topUpBtn.addEventListener('click', async () => {
    if (!acct) return;
    const v = amountOf(topUpF, acct.usdg, 'USDG'); if (v === null) return;
    await run(async () => [...(await approveStep(USDG, ADDR.VigilPremium, v, 'USDG for the premium escrow')), { label: `Top up escrow by ${usd(v)} USDG`, send: write(premium('topUp', [MARKET_ID, address, v])) }]);
    topUpF.input.value = '';
  });
  unusedBtn.addEventListener('click', async () => {
    if (!acct) return;
    const free = acct.owed > 0n ? 0n : (acct.debt > 0n ? acct.escrow - acct.minReserve : acct.escrow);
    const v = amountOf(unusedF, free > 0n ? free : 0n, 'USDG'); if (v === null) return;
    await run(async () => [{ label: `Withdraw ${usd(v)} USDG from escrow`, send: write(premium('withdrawUnused', [MARKET_ID, v])) }]);
    unusedF.input.value = '';
  });

  // Backstop
  depositBtn.addEventListener('click', async () => {
    if (!acct) return;
    const v = amountOf(depositF, acct.usdg, 'USDG'); if (v === null) return;
    await run(async () => [...(await approveStep(USDG, ADDR.VigilBackstop, v, 'USDG for the backstop')), { label: `Deposit ${usd(v)} USDG into the backstop`, send: write(backstop('deposit', [v, address])) }]);
    depositF.input.value = '';
  });
  requestBtn.addEventListener('click', async () => {
    if (!acct) return;
    const a = acct;
    const v = amountOf(requestF, a.vgAssets, 'USDG'); if (v === null) return;
    await run(async () => {
      // the contract takes shares: all of them when the whole deposit is requested, else previewWithdraw's (rounded up) amount
      const shares = v >= a.vgAssets ? a.vgShares : await client.readContract({ address: ADDR.VigilBackstop, abi: vigilBackstopAbi, functionName: 'previewWithdraw', args: [v] });
      return [{ label: `Request withdrawal of ${usd(v)} USDG (${formatUnits(shares, a.vgDecimals)} shares)`, send: write(backstop('requestWithdraw', [shares])) }];
    });
    requestF.input.value = '';
  });
  const claim = (r: WithdrawRequest) => run(async () => [{ label: `Claim request #${r.id}`, send: write(backstop('claimWithdraw', [r.id])) }]);

  // live "LTV after" preview while typing a borrow amount
  function previewBorrow() {
    const base = 'Borrowing power is computed at the oracle price — the haircut in force reduces it during a closure.';
    const v = parseAmount(borrowF.input.value, 6);
    if (!acct || !params || !snap || snap.price === null || v === null) { setText(borrowPreview, base); return; }
    const after = ltvBps(acct.collateral, snap.price, acct.debt + v);
    const lltvBps = Number(params.lltv / 10n ** 14n);
    setText(borrowPreview, after > lltvBps ? `LTV after: ${fmtBps(after)} — above the ${fmtBps(lltvBps)} LLTV, Morpho would reject it.` : `LTV after: ${fmtBps(after)} of ${fmtBps(lltvBps)}${after > 7600 ? ' — above the 76 % unwind target: a member would be unwound before the next close' : ''}.`);
  }
  borrowF.input.addEventListener('input', previewBorrow);

  // ── paint ──
  function paint() {
    const connected = address !== null;
    connectBtn.classList.toggle('hidden', connected);
    who.classList.toggle('hidden', !connected);
    switchBtn.classList.toggle('hidden', !connected || chainId === CHAIN_ID);
    if (address) { who.className = `badge ${chainId === CHAIN_ID ? 'badge-live' : 'badge-stale'}`; who.replaceChildren(el('i', { class: 'lamp' }), `${shortAddr(address)} · ${chainId === CHAIN_ID ? NETWORK_NAME : `chain ${chainId}`}`); }
    setEnabled(connected && !busy && acct !== null && params !== null && chainId === CHAIN_ID);
    if (!acct) {
      setText(balances, connected ? 'reading the account…' : 'Connect a wallet to see balances and act. Everything above stays readable without one.');
      for (const t of [lendTile, collTile, debtTile, ltvTile, roomTile, memTile, escTile, vgTile]) { setText(t.value, '—'); setText(t.note, ''); }
      for (const f of [supplyF, withdrawF, addCollF, borrowF, repayF, remCollF, topUpF, unusedF, depositF, requestF]) f.setMax(null);
      reqWrap.classList.add('hidden');
      return;
    }
    const a = acct;
    setText(balances, `${Number(formatUnits(a.eth, 18)).toFixed(4)} ETH · ${usd(a.usdg)} USDG · ${stk(a.stock)} ${SYMBOL}`);

    // Lend
    setText(lendTile.value, `${usd(a.supplied)} USDG`);
    setText(lendTile.note, a.totalSupplyAssets > 0n ? `${((Number(a.supplied) / Number(a.totalSupplyAssets)) * 100).toFixed(2)} % of ${usd(a.totalSupplyAssets, 0)} USDG supplied · ${usd(a.totalSupplyAssets - a.totalBorrowAssets, 0)} USDG idle` : 'nothing supplied yet');
    supplyF.setMax(a.usdg); withdrawF.setMax(a.supplied);

    // Borrow
    const price = snap?.price ?? null;
    const lltv = params?.lltv ?? 860_000_000_000_000_000n;
    const value = price === null ? null : collateralValue(a.collateral, price);
    const ltv = price === null ? null : ltvBps(a.collateral, price, a.debt);
    const room = price === null ? null : maxBorrowOf(a.collateral, price, lltv) - a.debt;
    setText(collTile.value, `${stk(a.collateral)} ${SYMBOL}`);
    setText(collTile.note, value === null ? 'oracle not pricing' : `≈ ${usd(value)} USDG at the oracle price`);
    setText(debtTile.value, `${usd(a.debt)} USDG`);
    setText(debtTile.note, a.debt > 0n ? 'accrues the market rate; the premium is separate' : 'no debt');
    setText(ltvTile.value, ltv === null ? '—' : fmtBps(ltv));
    ltvTile.value.classList.toggle('warn', ltv !== null && ltv >= 8000);
    setText(ltvTile.note, ltv === null ? '' : ltv >= 8600 ? 'liquidatable' : ltv >= 8000 ? 'above the 76 % unwind target' : 'healthy');
    setText(roomTile.value, room === null ? '—' : `${usd(room > 0n ? room : 0n)} USDG`);
    setText(roomTile.note, price === null ? 'the oracle reverts — borrows and liquidations are paused' : `at ${fmtUsd(Number(price / 10n ** 12n) / 1e12, 2)} USDG per ${SYMBOL} (haircut ${fmtBps(snap?.haircutNowBps ?? 0)} in force)`);
    addCollF.setMax(a.stock); borrowF.setMax(room !== null && room > 0n ? room : null); repayF.setMax(a.debt > 0n ? (a.debt < a.usdg ? a.debt : a.usdg) : null);
    remCollF.setMax(a.debt === 0n ? a.collateral : null);

    // Member
    const state = a.member ? 'Member' : a.authorized ? (a.delinquent ? 'Delinquent' : 'Authorised') : 'Not a member';
    setText(memTile.value, state);
    memTile.value.classList.toggle('warn', a.authorized && a.delinquent);
    setText(memTile.note, a.member ? 'soft unwind before the close and shortfall cover are active' : a.authorized ? `escrow below what is owed plus the 7-day reserve (${usd(a.minReserve)} USDG) — top up to restore cover` : 'authorise the soft unwind, then fund the escrow');
    setText(escTile.value, `${usd(a.escrow)} USDG`);
    setText(escTile.note, `owed ${usd(a.owed)} · reserve ${usd(a.minReserve)} · premium paid so far ${usd(a.paid)}`);
    joinBtn.classList.toggle('hidden', a.authorized); leaveBtn.classList.toggle('hidden', !a.authorized);
    setText(joinNote, a.authorized ? 'Revoking ends membership: no soft unwind, no cover, and the escrow stays yours.' : 'Lets VigilPreLiquidation repay part of your debt before a closure, at a discount it charges the unwinder, never you.');
    topUpF.setMax(a.usdg);
    const free = a.owed > 0n ? 0n : (a.debt > 0n ? a.escrow - a.minReserve : a.escrow);
    unusedF.setMax(free > 0n ? free : null);

    // Backstop
    setText(vgTile.value, `${usd(a.vgAssets)} USDG`);
    setText(vgTile.note, `${Number(formatUnits(a.vgShares, a.vgDecimals)).toLocaleString('en-US', { maximumFractionDigits: 4 })} vgUSDG shares at the current share price`);
    setText(vaultTile.value, snap ? `${usd(snap.backstopAssets, 0)} USDG` : '—');
    setText(vaultTile.note, snap ? `coverage cap ${usd(snap.coverageCap, 0)} · covered so far ${usd(snap.totalCovered)}` : '');
    depositF.setMax(a.usdg); requestF.setMax(a.vgAssets > 0n ? a.vgAssets : null);
    reqWrap.classList.toggle('hidden', reqs.length === 0);
    updateRequests();
  }

  // The request rows are rebuilt only when the account is re-read; paint() refreshes their status and buttons.
  let reqRows: { r: WithdrawRequest; st: HTMLElement; btn: HTMLButtonElement }[] = [];
  function buildRequests() {
    reqRows = reqs.map((r) => {
      const st = el('td', { text: '' });
      const btn = el('button', { class: 'btn-ghost', type: 'button', text: 'Claim' });
      btn.addEventListener('click', () => void claim(r));
      return { r, st, btn };
    });
    reqTable.replaceChildren(...reqRows.map(({ r, st, btn }) => el('tr', {},
      el('td', { class: 'mono', text: `#${r.id}` }), el('td', { class: 'mono', text: `≈ ${usd(r.assetsNow)} USDG` }),
      el('td', { class: 'mono', text: new Date(r.readyAt * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' }),
      st, el('td', {}, btn))));
  }
  function updateRequests() {
    const now = Math.floor(Date.now() / 1000);
    const marketOpen = snap ? snap.calRegime === 0 : false;
    for (const { r, st, btn } of reqRows) {
      const ready = now >= r.readyAt;
      setText(st, r.claimed ? 'claimed' : ready ? (marketOpen ? 'ready' : 'ready — claim during MARKET') : `cooldown ${fmtDuration(r.readyAt - now)}`);
      btn.disabled = r.claimed || !ready || !marketOpen || busy || chainId !== CHAIN_ID;
    }
  }

  return {
    root,
    render(s) { snap = s; paint(); },
  };
}
