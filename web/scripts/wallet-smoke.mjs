#!/usr/bin/env node
// Drives the transaction panel in a real browser against an Anvil fork, with a mock EIP-1193 wallet that forwards
// every request to the fork (anvil --auto-impersonate signs for any address). Proves the page can lend, borrow,
// join, back the vault and unwind all of it — no real key, no real funds.
//
//   anvil --fork-url https://rpc.testnet.chain.robinhood.com --chain-id 46630 --port 8549 --auto-impersonate &
//   npm run dev &                                         # http://127.0.0.1:5173/vigil/
//   node scripts/wallet-smoke.mjs [--account 0x…] [--rpc http://127.0.0.1:8549] [--page http://127.0.0.1:5173/vigil/]
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
const PAGE = flag('page', 'http://127.0.0.1:5173/vigil/');
const ACCOUNT = flag('account', '0x90351bB1E85a17D5f70c62C0cC076D39D897076D'); // the testnet deployer: holds USDG and TSLA on the fork
const OUT = flag('out', 'test/out');
fs.mkdirSync(OUT, { recursive: true });

const rpc = async (method, params = []) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
};
await rpc('anvil_setBalance', [ACCOUNT, '0x8AC7230489E80000']); // 10 ETH for gas
const chainHex = await rpc('eth_chainId');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// The mock wallet: accounts and chain are fixed, everything else goes straight to the fork.
await page.addInitScript(({ account, rpcUrl, chainHex }) => {
  const listeners = {};
  window.ethereum = {
    isMock: true,
    on: (e, f) => { (listeners[e] ??= []).push(f); },
    removeListener: (e, f) => { listeners[e] = (listeners[e] ?? []).filter((x) => x !== f); },
    request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
      if (method === 'eth_chainId') return chainHex;
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      const r = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }) });
      const j = await r.json();
      if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
      return j.result;
    },
  };
}, { account: ACCOUNT, rpcUrl: RPC, chainHex });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('  [console]', m.text().slice(0, 300)); });
await page.goto(`${PAGE}?rpc=${encodeURIComponent(RPC)}&poll=2000`, { waitUntil: 'load' });
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

await page.getByRole('button', { name: 'Connect wallet' }).click();
await page.waitForFunction(() => /USDG/.test(document.querySelector('#use .balances')?.textContent ?? ''), null, { timeout: 30_000 });
console.log('connected:', (await page.locator('#use .balances').innerText()).trim());
await page.screenshot({ path: `${OUT}/use-connected.png`, fullPage: false });

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
await browser.close();
