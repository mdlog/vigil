/**
 * Vigil keeper — the off-chain services a live market needs, in one file:
 *
 *   status      what the chain says: regime, feed, oracle price, index lag, backstop, market, every borrower's state
 *   poke        persist the premium index when it has fallen behind (anyone may; the bounty pays for it)
 *   unwind      soft-unwind every member that VigilPreLiquidation reports unwindable (the keeper pays USDG, gets collateral at a discount)
 *   liquidate   liquidateWithCover every position that is unhealthy at the oracle price (the keeper pays USDG, gets collateral + bounty)
 *   attest      sign and submit a tightening attestation (halt / delayed open) with the keeper-signer key
 *
 * Nothing is sent unless --send is given; without it every command prints what it would do. Reads the deployment
 * manifest (MANIFEST, default deployments/robinhood-testnet-46630.json) and the ABIs from ../out (run `forge build`).
 *
 *   OPS_PRIVATE_KEY=0x… npm run keeper -- unwind --send
 *   npm run keeper -- status --rpc http://127.0.0.1:8546            # against an Anvil fork
 *   OPS_PRIVATE_KEY=0x… npm run keeper -- attest --regime CLOSED --close-at now --next-open +1h --send
 *
 * Borrowers are discovered from Morpho's Borrow events on the market since the deployment block (the public RPCs
 * keep full logs), so the keeper needs no database.
 */
import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient, createWalletClient, defineChain, formatUnits, getAddress, http, maxUint256, parseAbiItem,
  type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { debtOf, isHealthy, ltvBps, parseWhen, REGIME, shortError } from "./lib.ts";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const cmd = args[0] ?? "status";
const flag = (name: string, dflt?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const has = (name: string) => args.includes(`--${name}`);
const SEND = has("send");
const VERBOSE = has("verbose");
const STRICT = has("strict"); // status: exit 1 on anything an operator must act on (feed unusable, stale index, uncovered shortfall)

const manifestPath = flag("manifest", process.env.MANIFEST ?? "deployments/robinhood-testnet-46630.json")!;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, manifestPath), "utf8")) as {
  chainId: number; rpc: string; explorer: string; firstBlock?: number; deployedAt: string;
  market: { id: Hex; collateralSymbol?: string }; contracts: Record<string, { address: string; block?: number }>;
};
const RPC = flag("rpc", process.env.RPC_URL ?? manifest.rpc)!;
const chain = defineChain({
  id: manifest.chainId, name: `chain-${manifest.chainId}`, nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http(RPC) });
const key = (process.env.OPS_PRIVATE_KEY ?? "") as Hex;
const account = key ? privateKeyToAccount(key) : undefined;
const wallet = account ? createWalletClient({ account, chain, transport: http(RPC) }) : undefined;

const abi = (name: string) =>
  (JSON.parse(fs.readFileSync(path.join(ROOT, "out", `${name}.sol`, `${name}.json`), "utf8")) as { abi: readonly unknown[] }).abi;
const A = (name: string) => getAddress(manifest.contracts[name].address);
const C = {
  session: { address: A("VigilSessionOracle"), abi: abi("VigilSessionOracle") },
  risk: { address: A("VigilRiskEngine"), abi: abi("VigilRiskEngine") },
  oracle: { address: A("VigilOracle"), abi: abi("VigilOracle") },
  premium: { address: A("VigilPremium"), abi: abi("VigilPremium") },
  backstop: { address: A("VigilBackstop"), abi: abi("VigilBackstop") },
  preLiq: { address: A("VigilPreLiquidation"), abi: abi("VigilPreLiquidation") },
  lossReporter: { address: A("VigilLossReporter"), abi: abi("VigilLossReporter") },
  morpho: { address: A("Morpho"), abi: abi("Morpho") },
  usdg: { address: A(manifest.contracts.USDG ? "USDG" : "MockUSDG"), abi: abi("MockUSDG") },
};
const STOCK = A(manifest.contracts.StockToken ? "StockToken" : "MockStockToken");
const ID = manifest.market.id;
const SYMBOL = manifest.market.collateralSymbol ?? "NVDA";
const usd = (v: bigint, d = 2) => Number(formatUnits(v, 6)).toFixed(d);
const read = <T,>(c: { address: Address; abi: readonly unknown[] }, functionName: string, a: unknown[] = []) =>
  pub.readContract({ address: c.address, abi: c.abi as never, functionName, args: a }) as Promise<T>;
/** The chain's clock, not the machine's: the contracts judge lag and attestations by block.timestamp. */
const chainNow = async () => Number((await pub.getBlock()).timestamp);

async function send(c: { address: Address; abi: readonly unknown[] }, functionName: string, a: unknown[], what: string) {
  if (!SEND) {
    console.log(`  would ${what}  (dry run — add --send)`);
    return;
  }
  if (!wallet || !account) throw new Error("OPS_PRIVATE_KEY is required with --send");
  const hash = await wallet.writeContract({ address: c.address, abi: c.abi as never, functionName, args: a, chain });
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${what} → ${r.status} ${manifest.explorer}/tx/${hash}`);
  if (r.status !== "success") throw new Error(`${what} reverted`);
}

/** Every address that ever borrowed on the market (Borrow events since deployment). */
async function borrowers(): Promise<Address[]> {
  const from = BigInt(manifest.firstBlock ?? manifest.contracts.Morpho.block ?? 0);
  const logs = await pub.getLogs({
    address: C.morpho.address,
    event: parseAbiItem("event Borrow(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)"),
    args: { id: ID }, fromBlock: from, toBlock: "latest",
  });
  return [...new Set(logs.map((l) => getAddress(l.args.onBehalf!)))];
}

type Pos = { borrower: Address; collateral: bigint; debt: bigint; ltvBps: number; healthy: boolean; member: boolean; unwindable: boolean; maxRepay: bigint; shortfall: bigint; coverable: bigint; covered: boolean };

async function positions(price: bigint | null): Promise<Pos[]> {
  const out: Pos[] = [];
  // public-mapping getters return the struct fields as separate outputs → arrays
  const [, , totalBorrowAssets, totalBorrowShares] = await read<[bigint, bigint, bigint, bigint, bigint, bigint]>(C.morpho, "market", [ID]);
  const [, , , , lltv] = await read<[Address, Address, Address, Address, bigint]>(C.morpho, "idToMarketParams", [ID]);
  for (const b of await borrowers()) {
    const [, borrowShares, collateral] = await read<[bigint, bigint, bigint]>(C.morpho, "position", [ID, b]);
    if (borrowShares === 0n && collateral === 0n) continue;
    const debt = debtOf(borrowShares, totalBorrowAssets, totalBorrowShares);
    const ltv = price === null ? 0 : ltvBps(collateral, price, debt);
    const healthy = price === null ? true : isHealthy(collateral, price, lltv, debt);
    const member = await read<boolean>(C.premium, "isMember", [ID, b]);
    const [unwindable, maxRepay] = await read<[boolean, bigint]>(C.preLiq, "isUnwindable", [ID, b]);
    let shortfall = 0n, coverable = 0n, covered = false;
    try {
      const r = await read<[bigint, bigint, boolean, boolean]>(C.lossReporter, "previewCover", [ID, b]);
      [shortfall, coverable, , covered] = r;
    } catch { /* oracle reverting: previewCover cannot price */ }
    out.push({ borrower: b, collateral, debt, ltvBps: ltv, healthy, member, unwindable, maxRepay, shortfall, coverable, covered });
  }
  return out;
}

async function oraclePrice(): Promise<bigint | null> {
  try { return await read<bigint>(C.oracle, "price"); } catch { return null; }
}

async function status() {
  const now = BigInt(await chainNow());
  const [eff, cal, closeAt, nextOpen] = await read<[number, number, bigint, bigint]>(C.session, "regimeOf", [STOCK]);
  const usable = await read<boolean>(C.session, "feedIsUsable", [STOCK]);
  const lastPoke = await read<bigint>(C.session, "lastPokeOf", [STOCK]);
  const price = await oraclePrice();
  const hair = await read<number>(C.risk, "haircutBps", [STOCK]);
  const assets = await read<bigint>(C.backstop, "totalAssets");
  const covered = await read<bigint>(C.backstop, "totalCovered");
  const cap = await read<bigint>(C.backstop, "coverageCap", [ID]);
  const [totalSupplyAssets, , totalBorrowAssets] = await read<[bigint, bigint, bigint, bigint, bigint, bigint]>(C.morpho, "market", [ID]);
  console.log(`== Vigil ${manifest.market.collateralSymbol ?? ""}/USDG on chain ${manifest.chainId} (${manifestPath}) at ${new Date().toISOString()}`);
  console.log(`  regime        ${REGIME[eff]} (calendar ${REGIME[cal]})  closeAt ${new Date(Number(closeAt) * 1000).toISOString()}  nextOpen ${new Date(Number(nextOpen) * 1000).toISOString()}`);
  console.log(`  feed          ${usable ? "usable" : "NOT USABLE — the oracle fails closed"}`);
  console.log(`  oracle        ${price === null ? "REVERTING" : `${(Number(price) / 1e24).toFixed(4)} USDG per ${SYMBOL}`}  haircut ${(hair / 100).toFixed(2)} %`);
  console.log(`  index lag     ${Number(now - lastPoke) / 3600 | 0} h since last poke${now - lastPoke > 24n * 3600n ? "  ← poke" : ""}`);
  console.log(`  backstop      ${usd(assets)} USDG, cap ${usd(cap, 0)}, covered so far ${usd(covered)}${cap > 0n && covered * 10n > cap * 8n ? "  ← cap 80 % used" : ""}`);
  console.log(`  market        ${usd(totalBorrowAssets)} / ${usd(totalSupplyAssets, 0)} USDG borrowed / supplied`);
  const pos = await positions(price);
  console.log(`  positions     ${pos.length}`);
  for (const p of pos) {
    console.log(`    ${p.borrower}  coll ${formatUnits(p.collateral, 18)} ${SYMBOL}  debt ${usd(p.debt)}  LTV ${(p.ltvBps / 100).toFixed(1)} %  member ${p.member}` +
      `${p.healthy ? "" : "  LIQUIDATABLE"}${p.unwindable ? `  UNWINDABLE (max repay ${usd(p.maxRepay)})` : ""}${p.shortfall > 0n ? `  SHORTFALL ${usd(p.shortfall)} (${p.covered ? "covered" : "NOT covered now"})` : ""}`);
  }
  if (account) console.log(`  keeper        ${account.address}: ${usd(await read<bigint>(C.usdg, "balanceOf", [account.address]))} USDG, ${formatUnits(await pub.getBalance({ address: account.address }), 18)} ETH`);
  const alerts = [
    !usable && "feed not usable",
    price === null && "oracle reverting",
    now - lastPoke > 24n * 3600n && "premium index not persisted for 24 h",
    pos.some((p) => p.shortfall > 0n && !p.covered) && "uncovered shortfall",
    pos.some((p) => !p.healthy) && "liquidatable position",
  ].filter(Boolean);
  if (alerts.length) console.log(`  ALERT         ${alerts.join("; ")}`);
  if (STRICT && alerts.length) throw new Error(alerts.join("; "));
  return { eff, usable, price, lastPoke, pos, cap, covered, assets };
}

async function ensureAllowance(spender: Address, amount: bigint) {
  if (!account) return;
  const cur = await read<bigint>(C.usdg, "allowance", [account.address, spender]);
  if (cur >= amount) return;
  await send(C.usdg, "approve", [spender, maxUint256], `approve USDG for ${spender}`);
}

async function poke() {
  const now = BigInt(await chainNow());
  const lastPoke = await read<bigint>(C.session, "lastPokeOf", [STOCK]);
  const maxLag = BigInt(flag("max-lag-hours", "6")!) * 3600n;
  if (now - lastPoke < maxLag) { console.log(`  index persisted ${Number(now - lastPoke) / 3600 | 0} h ago — nothing to do`); return; }
  await send(C.session, "poke", [STOCK], `poke ${SYMBOL} (lag ${Number(now - lastPoke) / 3600 | 0} h)`);
}

async function unwind() {
  const price = await oraclePrice();
  if (price === null) { console.log("  oracle reverting — cannot unwind"); return; }
  const todo = (await positions(price)).filter((p) => p.unwindable && p.maxRepay > 0n);
  if (!todo.length) { console.log("  no unwindable member"); return; }
  for (const p of todo) {
    const disc = await read<bigint>(C.preLiq, "currentDiscountBps", [ID, p.borrower]);
    await ensureAllowance(C.preLiq.address, p.maxRepay);
    await send(C.preLiq, "preLiquidate", [ID, p.borrower, p.maxRepay, "0x"], `unwind ${p.borrower}: repay ${usd(p.maxRepay)} USDG at ${Number(disc) / 100} % discount`);
  }
}

async function liquidate() {
  const price = await oraclePrice();
  if (price === null) { console.log("  oracle reverting — Morpho cannot liquidate either"); return; }
  const todo = (await positions(price)).filter((p) => p.debt > 0n && !p.healthy);
  if (!todo.length) { console.log("  every position is healthy at the oracle price"); return; }
  for (const p of todo) {
    await ensureAllowance(C.lossReporter.address, p.debt * 2n);
    const note = p.shortfall > 0n ? `shortfall ${usd(p.shortfall)}${p.covered ? " (backstop covers)" : " (NOT covered — Morpho would socialise it)"}` : "no shortfall";
    await send(C.lossReporter, "liquidateWithCover", [ID, p.borrower, "0x"], `liquidateWithCover ${p.borrower}: debt ${usd(p.debt)}, LTV ${(p.ltvBps / 100).toFixed(1)} %, ${note}`);
  }
}

/** --regime EXTENDED|OVERNIGHT|CLOSED --close-at <unix|now> --next-open <unix|+Nh> [--deadline-minutes 20] */
async function attest() {
  if (!account) throw new Error("OPS_PRIVATE_KEY (the keeperSigner) is required");
  const regime = REGIME.indexOf(flag("regime", "CLOSED")!);
  if (regime < 1 || regime > 3) throw new Error("regime must be EXTENDED, OVERNIGHT or CLOSED (a keeper can never attest CORP_ACTION)");
  // issuedAt must not be ahead of the chain (attest() reverts with Expired otherwise): anchor on the latest block
  const now = await chainNow();
  const [, , calClose, calNext] = await read<[number, number, bigint, bigint]>(C.session, "regimeOf", [STOCK]);
  const closeAt = parseWhen(flag("close-at"), Number(calClose), now);
  const nextOpen = parseWhen(flag("next-open"), Number(calNext), now);
  const a = { asset: STOCK, regime, closeAt: BigInt(closeAt), nextOpen: BigInt(nextOpen), issuedAt: BigInt(now), deadline: BigInt(now + Number(flag("deadline-minutes", "20")) * 60) };
  const digest = await read<Hex>(C.session, "hashAttestation", [a]);
  const sig = await account.sign({ hash: digest });
  console.log(`  attestation ${REGIME[regime]} closeAt ${new Date(closeAt * 1000).toISOString()} nextOpen ${new Date(nextOpen * 1000).toISOString()} (calendar: ${new Date(Number(calClose) * 1000).toISOString()} → ${new Date(Number(calNext) * 1000).toISOString()})`);
  await send(C.session, "attest", [a, sig], `attest ${REGIME[regime]} by ${account.address}`);
}

const commands: Record<string, () => Promise<unknown>> = { status, poke, unwind, liquidate, attest };
if (!commands[cmd]) {
  console.error(`unknown command ${cmd}; use one of ${Object.keys(commands).join(", ")}`);
  process.exit(2);
}
const report = (e: unknown) => console.error(VERBOSE ? e : `error: ${shortError(e)}  (--verbose for the full report)`);
if (has("loop")) {
  const every = Number(flag("loop", "300")) * 1000;
  for (;;) {
    console.log(`-- ${new Date().toISOString()}`);
    try { await commands[cmd](); } catch (e) { report(e); }
    await new Promise((r) => setTimeout(r, every));
  }
} else {
  try { await commands[cmd](); } catch (e) { report(e); process.exit(1); }
}
