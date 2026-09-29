#!/usr/bin/env node
// Merges the markets opened by AddMarkets.s.sol into a deployment manifest as `markets[]` (TSLA — the manifest's
// original `market` — first). Market ids, oracles and collateral come from Morpho's CreateMarket logs in the
// broadcast records; each feed is read from VigilSessionOracle.feedOf on-chain, so a reused feed is found too.
// Re-running with the same or more broadcasts gives the same file.
//
//   node script/markets.mjs --manifest deployments/robinhood-testnet-46630.json \
//     --broadcast broadcast/AddMarkets.s.sol/46630/run-latest.json[,…] --symbols AMD:0x7117…,AMZN:0x5884…,…
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../ops/package.json", import.meta.url));
const { createPublicClient, http, getAddress, parseAbi } = require("viem");

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const path = flag("manifest", "deployments/robinhood-testnet-46630.json");
const m = JSON.parse(fs.readFileSync(path, "utf8"));
const symOf = Object.fromEntries((flag("symbols", "") || "").split(",").filter(Boolean).map((s) => {
  const [sym, addr] = s.split(":");
  return [getAddress(addr), sym];
}));
const CREATE_MARKET = "0xac4b2400f169220b0c0afdde7a0b32e775ba727ea1cb30b35f935cdaab8683ac";
const word = (data, i) => `0x${data.slice(2 + 64 * i + 24, 2 + 64 * (i + 1))}`;

const markets = new Map();
const tsla = {
  symbol: m.market.collateralSymbol, id: m.market.id,
  stock: getAddress(m.contracts.StockToken.address), feed: getAddress(m.contracts.MockFeed.address),
  oracle: getAddress(m.contracts.VigilOracle.address), lltv: m.market.lltv,
  ...(m.market.feedInitial ? { feedInitial: m.market.feedInitial } : {}),
  tx: { ...(m.contracts.MockFeed.tx ? { feed: m.contracts.MockFeed.tx } : {}), ...(m.contracts.VigilOracle.tx ? { oracle: m.contracts.VigilOracle.tx } : {}) },
};
markets.set(tsla.symbol, tsla);
for (const old of m.markets ?? []) if (old.symbol !== tsla.symbol) markets.set(old.symbol, old);

const pub = createPublicClient({ transport: http(m.rpc) });
const session = getAddress(m.contracts.VigilSessionOracle.address);
for (const file of (flag("broadcast", "") || "").split(",").filter(Boolean)) {
  const run = JSON.parse(fs.readFileSync(file, "utf8"));
  if (run.chain !== m.chainId) throw new Error(`${file} is for chain ${run.chain}, not ${m.chainId}`);
  const creates = run.transactions.filter((t) => t.transactionType === "CREATE");
  const txOf = (addr) => creates.find((t) => getAddress(t.contractAddress) === getAddress(addr))?.hash;
  for (const r of run.receipts) {
    if (r.status !== "0x1") continue;
    for (const l of r.logs) {
      if (l.topics[0] !== CREATE_MARKET) continue;
      const stock = getAddress(word(l.data, 1));
      const oracle = getAddress(word(l.data, 2));
      const symbol = symOf[stock];
      if (!symbol) throw new Error(`CreateMarket for ${stock}: pass it in --symbols`);
      const feed = getAddress(await pub.readContract({ address: session, abi: parseAbi(["function feedOf(address) view returns (address)"]), functionName: "feedOf", args: [stock] }));
      const feedTx = txOf(feed);
      const oracleTx = txOf(oracle);
      markets.set(symbol, {
        ...markets.get(symbol), // keeps fields added by hand (feedInitial)
        symbol, id: l.topics[1], stock, feed, oracle, lltv: "0.86e18",
        tx: { ...(feedTx ? { feed: feedTx } : {}), ...(oracleTx ? { oracle: oracleTx } : {}), market: r.transactionHash },
        block: Number(r.blockNumber),
      });
    }
  }
}
m.markets = [...markets.values()];
fs.writeFileSync(path, JSON.stringify(m, null, 2) + "\n");
console.log(`wrote ${path}: ${m.markets.map((x) => x.symbol).join(", ")}`);
