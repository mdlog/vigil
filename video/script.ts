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

/** Transactions per phase of script/E2E.s.sol, in broadcast order. Sum = 37 (USDG comes from the deployer, not a mint). */
export const TX_PLAN: { phase: number; name: string; txs: number }[] = [
  { phase: 0, name: "fund", txs: 10 },
  { phase: 1, name: "supply", txs: 2 },
  { phase: 2, name: "borrow", txs: 8 },
  { phase: 3, name: "member", txs: 6 },
  { phase: 4, name: "backstop", txs: 3 },
  { phase: 5, name: "keeper", txs: 1 },
  { phase: 6, name: "unwind", txs: 2 },
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

/** Ordinal (1-based) of the transaction shown on the explorer: phase 8 is approve, then the first liquidateWithCover. */
export const COVER_TX_ORDINAL = firstTxOf(8) + 1;

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
  collateralNvda: number;
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

/** A static beat: one card from cards.html (screenshot in out/cards/<card>.png) held under its narration. */
export type CardBeat = {
  id: string;
  card: string;
  narrationDelayMs: number;
  /** never shorter than this, even if the narration is (a chart needs reading time) */
  minVisualS: number;
};

/** Camera plan for the take — known before the take, independent of its numbers. */
export const BEATS: BeatMeta[] = [
  { id: "00-title", startsAt: "title", view: "hero", narrationDelayMs: 600, skipIdle: { headS: 17, tailS: 9 } },
  { id: "01-supply-borrow", startsAt: 1, view: "economy", narrationDelayMs: 300 },
  { id: "02-member-backstop", startsAt: 3, view: "economy", narrationDelayMs: 300, skipIdle: { headS: 9, tailS: 9 } },
  { id: "03-keeper-unwind", startsAt: 5, view: "hero", narrationDelayMs: 200 },
  { id: "04-gap-liquidate", startsAt: 7, view: "price", narrationDelayMs: 200 },
  // ends at the take's end-card mark: the end card is a closing beat of its own (post-03-end)
  { id: "05-restore-end", startsAt: 9, view: "economy", narrationDelayMs: 300, skipIdle: { headS: 8, tailS: 15 } },
];

/** Static beats around the take: the problem and its evidence first, the wider evidence and the links last. */
export const OPENING: CardBeat[] = [
  { id: "pre-01-problem", card: "problem", narrationDelayMs: 500, minVisualS: 6 },
  { id: "pre-02-gaps", card: "chart-gaps", narrationDelayMs: 400, minVisualS: 12 },
];
export const CLOSING: CardBeat[] = [
  { id: "post-01-fork", card: "fork", narrationDelayMs: 400, minVisualS: 8 },
  { id: "post-02-backtest", card: "chart-backtest", narrationDelayMs: 400, minVisualS: 10 },
  { id: "post-03-end", card: "end", narrationDelayMs: 400, minVisualS: 5 },
];
/** Output order of every narrated beat. */
export const ORDER: string[] = [...OPENING.map((b) => b.id), ...BEATS.map((b) => b.id), ...CLOSING.map((b) => b.id)];

const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (bps: number) => (bps / 100).toFixed(bps % 100 === 0 ? 0 : 1);

/**
 * Numbers spoken outside the take. Each one is pinned to the file it comes from by
 * verify.sh (step 3b), the way the take's numbers are pinned to take.json.
 */
export const EVIDENCE = {
  years: "4.04", // calibrator/report_full.md — "4.04 years, 1014 closures"
  closures: "1014",
  gapAug2024: "14.18%", // calibrator/report_full.md — worst closures table, 2024-08-05
  gapJan2025: "12.49%", // calibrator/report_full.md — 2025-01-27
  lltv: "0.86", // calibrator/report_full.md — LLTV 0.86
  forkCoverUsdg: "31.20", // README.md — Mainnet fork table, weekendGapCycleOnRealMorpho
  plainBadDebtClosures: "3", // calibrator/report_full.md — Across tickers: NVDA 2 + AAPL 0 + TSLA 1
  premiumBp: "122.2", // calibrator/report_full.md — premium collected, max-LTV borrower, NVDA
  tailGpdBp: "299.2", // calibrator/report_full.md — expected bad debt beyond the buffer, GPD tail
  tailTfitBp: "17.8", // calibrator/report_full.md — t-fit
  calendarClosed: "50", // README.md — V15: 50 closures + 11 early closes match nyse.com
  calendarHalf: "11",
};

// Spoken text, verbatim in captions. Variables come from the take — never typed in.
export function narration(id: string, t: Take): string {
  switch (id) {
    // Andrew speaks ≈ 2.2 words/s and the take sits at its narration floor (≈ 125 s), so the five
    // cards share ≈ 55 s: numbers that are not spoken stay on the card (verify.sh pins those too).
    case "pre-01-problem":
      return `Robinhood Chain runs twenty-four seven. Chainlink equity feeds run twenty-four five — and freeze for the whole weekend.`;
    case "pre-02-gaps":
      return `Four years of NVDA overnight gaps. Both gaps that would have produced bad debt in an eighty-six percent market were Monday opens — and utilization-based interest charged nothing for either.`;
    case "post-01-fork":
      return `On a fork of mainnet the same contracts run against the real Morpho, USDG, NVDA token and Chainlink feed — the only thing injected is the gap.`;
    case "post-02-backtest":
      return `Four years, three tickers: three bad-debt closures on a plain market, zero on Vigil — for a premium of one hundred twenty-two basis points a year.`;
    case "post-03-end":
      return `The calendar is a verified on-chain table. Everything is open source.`;
    case "00-title":
      return `Vigil prices the risk that a stock market is closed. This is the public dashboard reading Robinhood Chain testnet, on a Saturday: the exchange regime is closed, the feed is frozen at ${fmt(t.feedBefore)}, and Vigil's oracle already reports ${fmt(t.priceBefore)}. On the right, a Foundry script starts a real end-to-end run. It funds five throwaway actors first, with gas and with Paxos USDG.`;
    case "01-supply-borrow":
      return `Alice supplies ${fmt(t.supplyUsdg, 0)} USDG to the NVDA market. Bob and Erin each post ${fmt(t.collateralNvda, 2)} NVDA and borrow ${fmt(t.debtUsdg, 2)} USDG — ${pct(t.ltv0Bps)} percent loan-to-value against a price that already carries the weekend haircut. Watch the market line: borrowed and supplied move as the transactions confirm.`;
    case "02-member-backstop":
      return `Both borrowers authorize Vigil's pre-liquidation and fund a premium escrow — that is what makes them members. Then Carol deposits ${fmt(t.backstopDepositUsdg, 0)} USDG into the first-loss backstop and requests ten percent back. Her exit waits seven days, so it always crosses a weekend.`;
    case "03-keeper-unwind":
      return `The keeper delays Monday's open by one hour — a keeper can only tighten, never loosen. Then Dave unwinds Bob while liquidity still exists: ${fmt(t.unwindRepaidUsdg, 2)} USDG repaid at a ${pct(t.unwindDiscountBps)} percent discount, Bob down to ${pct(t.ltvAfterUnwindBps)} percent loan-to-value.`;
    case "04-gap-liquidate":
      return `The Monday gap: the feed drops ${pct(t.dropBps)} percent — the NVDA gap of August 2024. The oracle falls to ${fmt(t.priceAfter)}. Dave liquidates both members: the backstop pays Erin's ${fmt(t.erinShortfallUsdg)} USDG shortfall in the same transaction, and Bob needs no cover.`;
    case "05-restore-end":
      return `The feed is restored. The backstop went from ${fmt(t.backstopBeforeUsdg, 2)} to ${fmt(t.backstopAfterUsdg, 2)} USDG; the suppliers' assets did not fall by a single unit. ${t.txCount} transactions, all real, all on the explorer. Vigil: session-aware collateral risk for tokenized equity, on Morpho Blue, on Robinhood Chain.`;
    default:
      throw new Error(`no narration for beat ${id}`);
  }
}

export function narrationFor(take: Take) {
  const delay = new Map<string, number>([...OPENING, ...BEATS, ...CLOSING].map((b) => [b.id, b.narrationDelayMs]));
  return ORDER.map((id) => ({ id, text: narration(id, take), delayMs: delay.get(id)! }));
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
if (isMain && process.argv.includes("--cards")) {
  process.stdout.write(JSON.stringify([...OPENING, ...CLOSING], null, 2) + "\n");
}
