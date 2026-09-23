#!/usr/bin/env node
// Drives the transaction panel in a real browser against an Anvil fork, with a mock EIP-1193 wallet that forwards
// every request to the fork (anvil --auto-impersonate signs for any address). Proves the page can lend, borrow,
// join, back the vault and unwind all of it — no real key, no real funds.
//
//   anvil --fork-url https://rpc.testnet.chain.robinhood.com --chain-id 46630 --port 8549 --auto-impersonate &
//   npm run dev &                                         # http://127.0.0.1:5173/vigil/dashboard/
//   node scripts/wallet-smoke.mjs [--account 0x…] [--rpc http://127.0.0.1:8549] [--page http://127.0.0.1:5173/vigil/dashboard/]
//
// Uses the Playwright install of ../video (pinned 1.61.1, Chromium already on disk) so the dashboard keeps no
// browser dependency of its own.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(new URL('../../video/package.json', import.meta.url));
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const RPC = flag('rpc', 'http://127.0.0.1:8549');
const PAGE = flag('page', 'http://127.0.0.1:5173/vigil/dashboard/');
const ACCOUNT = flag('account', '0x90351bB1E85a17D5f70c62C0cC076D39D897076D'); // the testnet deployer: holds USDG and TSLA on the fork
const OUT = flag('out', 'test/out');
const KEY_ENV = flag('key-env'); // e.g. --key-env PRIVATE_KEY: sign locally instead of relying on anvil's impersonation
const ONLY = flag('only'); // 'migrate' runs just the migration scenario (used for the recording)
const RECORD = args.includes('--record'); // save a video of the session to OUT/
fs.mkdirSync(OUT, { recursive: true });

const rpc = async (method, params = []) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
};
const chainHex = await rpc('eth_chainId');
let signer = null;
if (KEY_ENV) {
  const key = process.env[KEY_ENV];
  if (!key) throw new Error(`${KEY_ENV} is not set`);
  const { privateKeyToAccount } = await import('viem/accounts');
  const { createWalletClient, createPublicClient, http, defineChain } = await import('viem');
  const account = privateKeyToAccount(key);
  const chain = defineChain({ id: Number(chainHex), name: 'chain', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
  signer = { account, wallet: createWalletClient({ account, chain, transport: http(RPC) }), pub: createPublicClient({ chain, transport: http(RPC) }) };
  if (signer.account.address.toLowerCase() !== ACCOUNT.toLowerCase()) throw new Error(`--account must be the address of ${KEY_ENV}`);
} else {
  await rpc('anvil_setBalance', [ACCOUNT, '0x8AC7230489E80000']); // 10 ETH for gas on the fork
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...(RECORD ? { recordVideo: { dir: OUT, size: { width: 1280, height: 900 } } } : {}) });
const page = await context.newPage();
// The wallet the page sees. Without --key-env it forwards everything to the fork (anvil --auto-impersonate signs);
// with it, transactions and typed data are signed here in Node and only the raw transaction goes out.
let authorised = false; // like a real wallet: eth_accounts stays [] until the site has been approved once
await page.exposeBinding('__walletRequest', async (_source, method, params) => {
  if (method === 'eth_requestAccounts') { authorised = true; return [ACCOUNT]; }
  if (method === 'eth_accounts') return authorised ? [ACCOUNT] : [];
  if (method === 'eth_chainId') return chainHex;
  if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
  if (signer && method === 'eth_sendTransaction') {
    const t = params[0];
    return signer.wallet.sendTransaction({ to: t.to, data: t.data, value: t.value ? BigInt(t.value) : undefined, gas: t.gas ? BigInt(t.gas) : undefined });
  }
  if (signer && method === 'eth_signTypedData_v4') {
    const td = JSON.parse(params[1]);
    delete td.types.EIP712Domain;
    return signer.account.signTypedData({ domain: td.domain, types: td.types, primaryType: td.primaryType, message: td.message });
  }
  return rpc(method, params ?? []);
});
await page.addInitScript(() => {
  const listeners = {};
  window.ethereum = {
    isMock: true,
    on: (e, f) => { (listeners[e] ??= []).push(f); },
    removeListener: (e, f) => { listeners[e] = (listeners[e] ?? []).filter((x) => x !== f); },
    request: ({ method, params }) => window.__walletRequest(method, params ?? []),
  };
});

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('  [console]', m.text().slice(0, 300)); });
await page.goto(`${PAGE}?rpc=${encodeURIComponent(RPC)}&poll=2000#use-it`, { waitUntil: 'load' });
const use = page.locator('#use');
await use.scrollIntoViewIfNeeded();

const status = () => page.locator('#use .tx-status').innerText();
// tab, button label, field label (null = no amount), amount ('max' clicks the field's max button)
async function act(tab, label, fieldLabel, amount, expectText) {
  await page.getByRole('tab', { name: tab }).click();
  if (fieldLabel !== null) {
    const f = page.locator('#use .pane:not(.hidden) .field', { has: page.locator('.field-label', { hasText: new RegExp(`^${fieldLabel}$`) }) });
    if (amount === 'max') await f.getByRole('button', { name: 'max' }).click();
    else await f.locator('input').fill(amount);
  }
  const buttonName = label === 'Join' ? /Join/ : label === 'Leave' ? /Leave/ : new RegExp(`^${label}$`);
  const button = page.locator('#use .pane:not(.hidden)').getByRole('button', { name: buttonName });
  await button.waitFor({ state: 'visible' });
  await page.waitForFunction((b) => !b.disabled, await button.elementHandle(), { timeout: 60_000 }); // enabled once the account and market params are read
  await button.click();
  try {
    await page.waitForFunction(() => { const e = document.querySelector('#use .tx-status'); return e?.dataset.done === '1' || /more than|Enter a/.test(e?.textContent ?? ''); }, null, { timeout: 90_000 });
  } catch (e) {
    console.log(`  timeout; status = "${await status()}"`);
    throw e;
  }
  const s = await status();
  const ok = s.includes('confirmed') && (!expectText || s.includes(expectText));
  console.log(`${ok ? 'ok ' : 'FAIL'} ${tab} / ${label} ${amount ?? ''} → ${s.replace(/\s+/g, ' ').slice(0, 110)}`);
  if (!ok) throw new Error(`${tab}/${label}: ${s}`);
}
async function tile(kicker) { return page.locator('#use .tile', { hasText: kicker }).locator('.big').first().innerText(); }

// connect from the header — the page's only Connect button — then prove a reload reconnects without a prompt
const balances = () => page.waitForFunction(() => /USDG/.test(document.querySelector('#use .balances')?.textContent ?? ''), null, { timeout: 30_000 });
await page.locator('.dashboard-topbar').getByRole('button', { name: /Connect/ }).click();
await balances();
console.log('connected:', (await page.locator('#use .balances').innerText()).trim(), '| header:', (await page.locator('.dashboard-topbar .wallet-chip').innerText()).trim());
await page.reload({ waitUntil: 'load' });
await balances();
console.log('reconnected after a reload, no prompt:', (await page.locator('.dashboard-topbar .wallet-chip').innerText()).trim());
await page.screenshot({ path: `${OUT}/use-connected.png`, fullPage: false });

if (ONLY === 'migrate') {
  await page.getByRole('tab', { name: 'Lend' }).click();
  await page.waitForFunction(() => /Your supply there/.test(document.querySelector('#use .pane:not(.hidden) .form:nth-child(3) .muted')?.textContent ?? ''), null, { timeout: 60_000 });
  console.log('   before:', await tile('Your supply'), '|', (await page.locator('#use .pane:not(.hidden) .form:nth-child(3) .muted').innerText()).trim());
  await page.screenshot({ path: `${OUT}/migrate-before.png` });
  await page.waitForTimeout(RECORD ? 2500 : 0);
  await act('Lend', 'Migrate to the Vigil market', null, null, 'Migrate');
  // the page re-reads the old position until the RPC shows it moved (public RPCs lag a block behind the receipt)
  await page.waitForFunction(() => /there: 0\.00 USDG/.test(document.querySelector('#use .pane:not(.hidden) .form:nth-child(3) .muted')?.textContent ?? ''), null, { timeout: 20_000 }).catch(() => {});
  console.log('   after: ', await tile('Your supply'), '|', (await page.locator('#use .pane:not(.hidden) .form:nth-child(3) .muted').innerText()).trim());
  await page.screenshot({ path: `${OUT}/migrate-after.png` });
  const link = await page.locator('#use .tx-status a').getAttribute('href');
  console.log('   tx:', link);
  if (RECORD) {
    await page.waitForTimeout(4000);
    await page.goto(link, { waitUntil: 'load' });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${OUT}/migrate-explorer.png`, fullPage: false });
  }
  if (errors.length) { console.log('page errors:', errors); process.exit(1); }
  const video = RECORD ? await page.video()?.path() : null;
  await context.close(); await browser.close();
  if (video) console.log('video:', video);
  process.exit(0);
}

await act('Lend', 'Supply', 'Supply', '10', 'Supply 10.00 USDG');
console.log('   your supply:', await tile('Your supply'));
await act('Borrow', 'Add collateral', 'Add collateral', '0.01');
await act('Borrow', 'Borrow', 'Borrow', '1');
console.log('   collateral:', await tile('Collateral'), '| debt:', await tile('Debt'), '| LTV:', await tile('LTV'));
await page.screenshot({ path: `${OUT}/use-borrow.png` });
await page.getByRole('tab', { name: 'Member' }).click();
if ((await tile('Membership')) === 'Not a member') await act('Member', 'Join', null, null);
else console.log('   already authorised on this fork — skipping Join');
await act('Member', 'Top up', 'Top up escrow', '0.5');
console.log('   membership:', await tile('Membership'), '| escrow:', await tile('Premium escrow'));
await page.screenshot({ path: `${OUT}/use-member.png` });
await act('Backstop', 'Deposit', 'Deposit', '5');
await act('Backstop', 'Request', 'Request withdrawal', '2');
console.log('   backstop deposit:', await tile('Your backstop deposit'));
console.log('   requests:', (await page.locator('#use tbody').innerText()).replace(/\s+/g, ' '));
await page.screenshot({ path: `${OUT}/use-backstop.png` });
// unwind everything: repay all, withdraw the collateral, the supply and the unused escrow — each with "max"
if (!KEY_ENV) {
  // let interest accrue first: the page reads Morpho's stored totals, so "Repay max" must pay more than the debt it shows
  await rpc('evm_increaseTime', [3600]);
  await rpc('evm_mine', []);
}
await act('Borrow', 'Repay', 'Repay', 'max');
await act('Borrow', 'Withdraw collateral', 'Withdraw collateral', 'max');
console.log('   after unwind — collateral:', await tile('Collateral'), '| debt:', await tile('Debt'));
await act('Lend', 'Withdraw', 'Withdraw', 'max');
console.log('   your supply:', await tile('Your supply'));
await act('Member', 'Withdraw unused', 'Withdraw unused', 'max');
console.log('   escrow:', await tile('Premium escrow'));
// a rejected action must surface as a readable message, not a thrown promise
await page.getByRole('tab', { name: 'Borrow' }).click();
await page.locator('#use .pane:not(.hidden) .field', { has: page.locator('.field-label', { hasText: /^Borrow$/ }) }).locator('input').fill('5');
await page.locator('#use .pane:not(.hidden)').getByRole('button', { name: /^Borrow$/ }).click();
await page.waitForFunction(() => /more than|Enter a|reverted|Error/.test(document.querySelector('#use .tx-status')?.textContent ?? ''), null, { timeout: 30_000 });
console.log('ok  Borrow without collateral →', (await status()).replace(/\s+/g, ' ').slice(0, 100));

if (errors.length) { console.log('page errors:', errors); process.exit(1); }
console.log(`done — screenshots in ${OUT}/`);
await context.close();
await browser.close();
