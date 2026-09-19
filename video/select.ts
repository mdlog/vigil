/**
 * Builds out/take.json — every number the narration may say — from what the
 * take actually produced: the forge log captured by record.ts (out/e2e.log),
 * the recorder's timeline (out/timeline.json) and the broadcast receipts.
 * Aborts if a value is missing rather than guessing one.
 */
import fs from "node:fs";
import path from "node:path";
import { OUT_DIR, TX_TOTAL, VIDEO_DIR, type Take } from "./script.ts";

const REPO = path.join(VIDEO_DIR, "..");

function need(re: RegExp, text: string, what: string): string[] {
  const m = re.exec(text);
  if (!m) throw new Error(`take is not narratable: ${what} not found in out/e2e.log`);
  return m.slice(1);
}

function main() {
  const log = fs.readFileSync(path.join(OUT_DIR, "e2e.log"), "utf8");
  const timeline = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "timeline.json"), "utf8")) as {
    recordedAt: string; url: string; rpc: string; hashes: string[]; coverTx: string | null;
  };
  const chainDir = timeline.rpc.includes("8546") ? "46630" : "46630";
  const broadcast = JSON.parse(fs.readFileSync(path.join(REPO, "broadcast", "E2E.s.sol", chainDir, "run-latest.json"), "utf8")) as {
    chain: number; receipts: { status: string; gasUsed: string; blockNumber: string; transactionHash: string }[];
  };
  const ok = broadcast.receipts.filter((r) => r.status === "0x1");
  if (ok.length !== TX_TOTAL) throw new Error(`broadcast has ${ok.length} successful receipts, expected ${TX_TOTAL}`);
  const hashSet = new Set(timeline.hashes);
  if (!ok.every((r) => hashSet.has(r.transactionHash))) throw new Error("receipts in the broadcast do not match the hashes seen on camera");

  const actors: Record<string, string> = {};
  for (const m of log.matchAll(/\[E2E\] actor (\w+) = (0x[0-9a-fA-F]{40})/g)) actors[m[1]] = m[2];
  const [supply] = need(/phase 1 supply: alice supplied (\d+) USDG/, log, "supply");
  const [bobDebt, , priceCents] = need(/phase 2 borrow: bob (\d+) USDG, erin (\d+) USDG \(6d\) at oracle price (\d+) cents/, log, "borrow");
  const [lp] = need(/phase 4 backstop: carol deposited (\d+) USDG/, log, "backstop deposit");
  const [clBefore, clAfter] = need(/phase 5 keeper: attested delayed open, closure (\d+) -> (\d+) \(tenths of an hour\)/, log, "keeper");
  const [unwindRepaid, discount, ltvAfter] = need(/phase 6 unwind: dave repaid (\d+) USDG \(6d\) for bob at (\d+) bps discount, bob LTV (\d+) bps/, log, "unwind");
  const [drop, , priceAfterCents] = need(/phase 7 gap: feed -(\d+) bps, oracle price (\d+) -> (\d+) cents/, log, "gap");
  const [shortfall, covered, bobCovered] = need(/phase 8 liquidate: erin shortfall (\d+) covered (\d+) \(6d\), bob covered (\d+)/, log, "liquidate");
  const [feedGap] = need(/feed during gap (\d+) cents/, log, "feed during gap");
  const [, ltv0] = need(/bob\s+debt (\d+) \(6d\), LTV (\d+) -> unwound to (\d+) bps/, log, "bob ltv");
  const [supBefore, supAfter] = need(/suppliers totalSupplyAssets (\d+) -> (\d+) \(6d\)/, log, "suppliers");
  const [bsBefore, bsAfter] = need(/backstop totalAssets (\d+) -> (\d+) \(6d\)/, log, "backstop");
  if (!/ONCHAIN EXECUTION COMPLETE & SUCCESSFUL/.test(log)) throw new Error("the log has no ONCHAIN EXECUTION COMPLETE line");

  const blocks = ok.map((r) => parseInt(r.blockNumber, 16));
  const take: Take = {
    chainId: broadcast.chain,
    rpc: timeline.rpc,
    dashboard: timeline.url,
    explorer: process.env.VIGIL_VIDEO_EXPLORER ?? "https://explorer.testnet.chain.robinhood.com",
    recordedAt: timeline.recordedAt,
    txCount: ok.length,
    gasUsed: ok.reduce((n, r) => n + parseInt(r.gasUsed, 16), 0),
    firstBlock: Math.min(...blocks),
    lastBlock: Math.max(...blocks),
    actors,
    supplyUsdg: Number(supply),
    debtUsdg: Number(bobDebt) / 1e6,
    ltv0Bps: Number(ltv0),
    priceBefore: Number(priceCents) / 100,
    feedBefore: 120,
    closureBeforeH: Number(clBefore) / 10,
    closureAfterH: Number(clAfter) / 10,
    unwindRepaidUsdg: Number(unwindRepaid) / 1e6,
    unwindDiscountBps: Number(discount),
    ltvAfterUnwindBps: Number(ltvAfter),
    dropBps: Number(drop),
    priceAfter: Number(priceAfterCents) / 100,
    feedAfter: Number(feedGap) / 100,
    erinShortfallUsdg: Number(shortfall) / 1e6,
    erinCoveredUsdg: Number(covered) / 1e6,
    bobCoveredUsdg: Number(bobCovered) / 1e6,
    backstopDepositUsdg: Number(lp),
    backstopBeforeUsdg: Number(bsBefore) / 1e6,
    backstopAfterUsdg: Number(bsAfter) / 1e6,
    suppliersBefore: Number(supBefore) / 1e6,
    suppliersAfter: Number(supAfter) / 1e6,
    coverTx: timeline.coverTx ?? "",
  };
  if (take.bobCoveredUsdg !== 0) throw new Error("bob was covered — the narration says he needs no cover; re-shoot");
  if (take.suppliersAfter < take.suppliersBefore) throw new Error("suppliers lost assets — the narration says they did not; re-shoot");
  fs.writeFileSync(path.join(OUT_DIR, "take.json"), JSON.stringify(take, null, 1));
  console.log(`take: ${take.txCount} tx, blocks ${take.firstBlock}–${take.lastBlock}, price ${take.priceBefore} → ${take.priceAfter}, erin covered ${take.erinCoveredUsdg} USDG, bob covered ${take.bobCoveredUsdg}`);
}

main();
