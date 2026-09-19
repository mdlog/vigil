/**
 * Single source of truth for the E2E recording: the transaction plan of
 * script/E2E.s.sol, the beats cut from the continuous take, and their
 * narration. Every number in the narration comes from out/take.json, which
 * select.ts reads from the forge log and the broadcast receipts of the take.
 */
import fs from "node:fs";
import path from "node:path";

export const VIDEO_DIR = path.dirname(new URL(import.meta.url).pathname);
export const OUT_DIR = path.join(VIDEO_DIR, "out");
export const PUBLIC_HOST = "mdlog.github.io/vigil";

/** Transactions per phase of script/E2E.s.sol, in broadcast order. Sum = 37. */
export const TX_PLAN: { phase: number; name: string; txs: number }[] = [
  { phase: 0, name: "fund", txs: 5 },
  { phase: 1, name: "supply", txs: 3 },
  { phase: 2, name: "borrow", txs: 8 },
  { phase: 3, name: "member", txs: 8 },
  { phase: 4, name: "backstop", txs: 4 },
  { phase: 5, name: "keeper", txs: 1 },
  { phase: 6, name: "unwind", txs: 3 },
  { phase: 7, name: "gap", txs: 1 },
  { phase: 8, name: "liquidate", txs: 3 },
  { phase: 9, name: "restore", txs: 1 },
];
export const TX_TOTAL = TX_PLAN.reduce((n, p) => n + p.txs, 0);

/** Phase reached after `confirmed` transactions (phase 0 before any). */
export function phaseAt(confirmed: number): number {
  let acc = 0;
  for (const p of TX_PLAN) {
    if (confirmed <= acc) return Math.max(0, p.phase - 1);
    acc += p.txs;
    if (confirmed <= acc) return p.phase;
  }
  return TX_PLAN[TX_PLAN.length - 1].phase;
}

/** First confirmed-transaction ordinal (1-based) that belongs to `phase`. */
export function firstTxOf(phase: number): number {
  let acc = 0;
  for (const p of TX_PLAN) {
    if (p.phase === phase) return acc + 1;
    acc += p.txs;
  }
  throw new Error(`unknown phase ${phase}`);
}

export type Take = {
  chainId: number;
  rpc: string;
  dashboard: string;
  explorer: string;
  recordedAt: string;
  txCount: number;
  gasUsed: number;
  firstBlock: number;
  lastBlock: number;
  actors: Record<string, string>;
  supplyUsdg: number;
  debtUsdg: number;
  ltv0Bps: number;
  priceBefore: number;
  feedBefore: number;
  closureBeforeH: number;
  closureAfterH: number;
  unwindRepaidUsdg: number;
  unwindDiscountBps: number;
  ltvAfterUnwindBps: number;
  dropBps: number;
  priceAfter: number;
  feedAfter: number;
  erinShortfallUsdg: number;
  erinCoveredUsdg: number;
  bobCoveredUsdg: number;
  backstopDepositUsdg: number;
  backstopBeforeUsdg: number;
  backstopAfterUsdg: number;
  suppliersBefore: number;
  suppliersAfter: number;
  coverTx: string;
};

export type View = "hero" | "economy" | "price";

export type BeatMeta = {
  id: string;
  /** phase whose first confirmed transaction starts the beat; 'title' = t0 */
  startsAt: number | "title";
  /** what the camera does when the beat starts */
  view: View;
  narrationDelayMs: number;
  /** keep only the first headS and the last tailS seconds of the beat's footage (forge's simulation is idle time) */
  skipIdle?: { headS: number; tailS: number };
  /** delay the narration so it ends just before the end card (last beat) */
  endBeforeCard?: boolean;
};

/** Camera plan — known before the take, independent of its numbers. */
export const BEATS: BeatMeta[] = [
  { id: "00-title", startsAt: "title", view: "hero", narrationDelayMs: 600, skipIdle: { headS: 17, tailS: 9 } },
  { id: "01-supply-borrow", startsAt: 1, view: "economy", narrationDelayMs: 300 },
  { id: "02-member-backstop", startsAt: 3, view: "economy", narrationDelayMs: 300 },
  { id: "03-keeper-unwind", startsAt: 5, view: "hero", narrationDelayMs: 200 },
  { id: "04-gap-liquidate", startsAt: 7, view: "price", narrationDelayMs: 200 },
  { id: "05-restore-end", startsAt: 9, view: "economy", narrationDelayMs: 300, endBeforeCard: true },
];

const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (bps: number) => (bps / 100).toFixed(bps % 100 === 0 ? 0 : 1);

// Spoken text, verbatim in captions. Variables come from the take — never typed in.
export function narration(id: string, t: Take): string {
  switch (id) {
    case "00-title":
      return `Vigil prices the risk that a stock market is closed. This is the public dashboard reading Robinhood Chain testnet, on a Saturday: the exchange regime is closed, the feed is frozen at ${fmt(t.feedBefore)}, and Vigil's oracle already reports ${fmt(t.priceBefore)}. On the right, a Foundry script starts a real end-to-end run. It funds five throwaway actors first.`;
    case "01-supply-borrow":
      return `Alice supplies ${fmt(t.supplyUsdg, 0)} mock USDG to the NVDA market. Bob and Erin each post ten NVDA and borrow ${fmt(t.debtUsdg, 0)} USDG — ${pct(t.ltv0Bps)} percent loan-to-value against a price that already carries the weekend haircut. Watch the market line: borrowed and supplied move as the transactions confirm.`;
    case "02-member-backstop":
      return `Both borrowers authorize Vigil's pre-liquidation and fund a premium escrow — that is what makes them members. Then Carol deposits ${fmt(t.backstopDepositUsdg, 0)} USDG into the first-loss backstop and requests ten percent back. Her exit waits seven days, so it always crosses a weekend.`;
    case "03-keeper-unwind":
      return `The keeper delays Monday's open by one hour — a keeper can only tighten, never loosen. Then Dave unwinds Bob while liquidity still exists: ${fmt(t.unwindRepaidUsdg, 0)} USDG repaid at a ${pct(t.unwindDiscountBps)} percent discount, Bob down to ${pct(t.ltvAfterUnwindBps)} percent loan-to-value.`;
    case "04-gap-liquidate":
      return `The Monday gap: the feed drops ${pct(t.dropBps)} percent — the NVDA gap of August 2024. The oracle falls to ${fmt(t.priceAfter)}. Dave liquidates both members: the backstop pays Erin's ${fmt(t.erinShortfallUsdg)} USDG shortfall in the same transaction, and Bob needs no cover.`;
    case "05-restore-end":
      return `The feed is restored. The backstop went from ${fmt(t.backstopBeforeUsdg, 0)} to ${fmt(t.backstopAfterUsdg, 2)} USDG; the suppliers' assets did not fall by a single unit. ${t.txCount} transactions, all real, all on the explorer. Vigil: session-aware collateral risk for tokenized equity, on Morpho Blue, on Robinhood Chain.`;
    default:
      throw new Error(`no narration for beat ${id}`);
  }
}

export function narrationFor(take: Take) {
  return BEATS.map((b) => ({ id: b.id, text: narration(b.id, take), delayMs: b.narrationDelayMs }));
}

export function readTake(): Take {
  return JSON.parse(fs.readFileSync(path.join(OUT_DIR, "take.json"), "utf8")) as Take;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain && process.argv.includes("--narration")) {
  process.stdout.write(JSON.stringify(narrationFor(readTake()), null, 2) + "\n");
}
if (isMain && process.argv.includes("--beats")) {
  process.stdout.write(JSON.stringify(BEATS, null, 2) + "\n");
}
