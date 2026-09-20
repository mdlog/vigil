#!/usr/bin/env node
// Writes a deployment manifest (the file deployments/*.json that the dashboard, the keeper, E2E.s.sol and
// Handover.s.sol read) from Forge's broadcast record plus the env file the deployment was run with, so the
// manifest can never disagree with what was actually sent:
//
//   node script/manifest.mjs --chain 4663 --env .env.mainnet --out deployments/robinhood-mainnet-4663.json
//   node script/manifest.mjs --chain 46630 --env .env --out /tmp/check.json     # reproduce the testnet one
//
// Every CREATE in broadcast/Deploy.s.sol/<chain>/run-latest.json becomes a contract entry (address, tx, block);
// every dependency that came from the env (MORPHO, IRM, USDG, STOCK_TOKEN, FEED, USDG_FEED) becomes an
// `external: true` entry; the market id is taken from Morpho's CreateMarket log. Only those six variables and
// SYMBOL are read from the env file — never PRIVATE_KEY.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const chain = Number(flag("chain", "46630"));
const NET = {
  46630: { network: "Robinhood Chain testnet", rpc: "https://rpc.testnet.chain.robinhood.com", explorer: "https://explorer.testnet.chain.robinhood.com", suffix: "testnet" },
  4663: { network: "Robinhood Chain mainnet", rpc: "https://rpc.mainnet.chain.robinhood.com", explorer: "https://robinhoodchain.blockscout.com", suffix: "mainnet" },
}[chain];
if (!NET) throw new Error(`unknown chain ${chain}`);

const env = {};
const envPath = flag("env");
if (envPath) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && ["MORPHO", "IRM", "USDG", "STOCK_TOKEN", "FEED", "USDG_FEED", "SYMBOL", "LLTV", "FEED_INITIAL"].includes(m[1])) env[m[1]] = m[2];
  }
}
for (const k of ["MORPHO", "IRM", "USDG", "STOCK_TOKEN", "FEED", "USDG_FEED", "SYMBOL", "LLTV", "FEED_INITIAL"]) if (process.env[k]) env[k] = process.env[k];
const symbol = env.SYMBOL || "NVDA";

const run = JSON.parse(fs.readFileSync(flag("broadcast", `broadcast/Deploy.s.sol/${chain}/run-latest.json`), "utf8"));
if (run.chain !== chain) throw new Error(`broadcast is for chain ${run.chain}, not ${chain}`);
const receiptOf = Object.fromEntries(run.receipts.map((r) => [r.transactionHash, r]));
const contracts = {};
for (const t of run.transactions) {
  if (t.transactionType !== "CREATE") continue;
  const r = receiptOf[t.hash];
  if (!r || r.status !== "0x1") throw new Error(`no successful receipt for ${t.contractName} ${t.hash}`);
  contracts[t.contractName] = { address: t.contractAddress, tx: t.hash, block: Number(r.blockNumber) };
}
const deployer = run.transactions[0].transaction.from;
const CREATE_MARKET = "0xac4b2400f169220b0c0afdde7a0b32e775ba727ea1cb30b35f935cdaab8683ac"; // CreateMarket(bytes32 indexed, MarketParams)
let marketId;
for (const r of run.receipts) for (const l of r.logs) if (l.topics[0] === CREATE_MARKET) marketId = l.topics[1];
if (!marketId) throw new Error("no CreateMarket log in the broadcast");

const ext = (name, address, issuer) => { if (address) contracts[name] = { address, issuer, external: true }; };
const mainnet = chain === 4663;
ext("Morpho", env.MORPHO, "Morpho Blue on Robinhood Chain (Morpho Labs)");
ext("IRM", env.IRM, "AdaptiveCurveIRM (Morpho Labs)");
ext("USDG", env.USDG, `Paxos — Global Dollar (USDG) on ${NET.network}, 6 decimals, EIP-1967 proxy`);
ext("StockToken", env.STOCK_TOKEN, `Robinhood — ${symbol} stock token on ${NET.network} (ERC-8056, BeaconProxy of the Stock implementation)`);
ext("Feed", env.FEED, `Chainlink ${symbol}/USD feed, 8 decimals`);
ext("UsdgFeed", env.USDG_FEED, "Chainlink USDG/USD feed, 8 decimals");
const has = (n) => n in contracts;
const blocks = Object.values(contracts).filter((c) => c.block).map((c) => c.block);

const manifest = {
  chainId: chain,
  network: NET.network,
  rpc: NET.rpc,
  explorer: NET.explorer,
  deployer,
  deployedAt: new Date(run.timestamp > 1e12 ? run.timestamp : run.timestamp * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"), // forge writes ms
  version: Number(flag("version", "1")),
  ...(flag("previous") ? { previous: flag("previous") } : {}),
  notes: flag("notes", [
    `${symbol}/USDG market on ${NET.network}.`,
    has("Morpho") && contracts.Morpho.external ? "Morpho Blue, the IRM," : "Morpho Blue and the IRM are deployed here from source;",
    has("Feed") ? `the ${symbol}/USD feed and USDG are the live ones.` : "the feed is a mock (no Chainlink feeds on this network).",
    `Surface: the ${symbol} calibration.`,
  ].join(" ")),
  market: {
    id: marketId,
    loanToken: has("USDG") ? `USDG (Paxos, ${NET.suffix})` : "MockUSDG",
    collateralToken: has("StockToken") ? `${symbol} (Robinhood, ${NET.suffix})` : `MockStockToken (${symbol})`,
    collateralSymbol: symbol,
    oracle: "VigilOracle",
    irm: has("IRM") ? "AdaptiveCurveIRM" : "MockIRM",
    lltv: env.LLTV ? `${Number(env.LLTV) / 1e18}e18` : "0.86e18",
    ...(has("MockFeed") && env.FEED_INITIAL ? { feedInitial: String(Number(env.FEED_INITIAL) / 1e8) } : {}),
  },
  contracts,
  transactions: run.transactions.length,
  gasUsed: run.receipts.reduce((s, r) => s + Number(r.gasUsed), 0),
  firstBlock: Math.min(...blocks),
};
if (mainnet && !(has("Morpho") && has("USDG") && has("StockToken") && has("Feed"))) {
  throw new Error("a mainnet manifest must reference the real Morpho, USDG, stock token and feed (pass --env .env.mainnet)");
}
const out = flag("out");
const text = JSON.stringify(manifest, null, 2) + "\n";
if (out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  console.log(`wrote ${out}: ${Object.keys(contracts).length} contracts, market ${marketId}`);
} else {
  process.stdout.write(text);
}
