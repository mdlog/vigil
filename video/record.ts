/**
 * One continuous take: the public dashboard on the left, the live forge log on
 * the right, while script/E2E.s.sol broadcasts to the chain. The chain is the
 * clock — beats start when a phase's first transaction confirms — so the take
 * is cut afterwards (build.py) and narrated from the numbers it produced.
 *
 *   --probe   load the page, dock the terminal, show the cards; no forge, no video
 *   --cards   only screenshot the static cards to out/cards/<card>.png (opening/closing beats)
 *   --fork    rehearse against the Anvil fork on 127.0.0.1:8546 (real video, no cost)
 *
 * env: VIGIL_VIDEO_URL, VIGIL_VIDEO_RPC, VIGIL_VIDEO_EXPLORER override the defaults.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";
import { BEATS, CLOSING, COVER_TX_ORDINAL, OPENING, OUT_DIR, TX_PLAN, TX_TOTAL, VIDEO_DIR, phaseAt, type View } from "./script.ts";

const PROBE = process.argv.includes("--probe");
const CARDS_ONLY = process.argv.includes("--cards");
const FORK = process.argv.includes("--fork");
const REPO = path.join(VIDEO_DIR, "..");
const RAW = path.join(OUT_DIR, "raw");
const EXPLORER = process.env.VIGIL_VIDEO_EXPLORER ?? "https://explorer.testnet.chain.robinhood.com";
const RPC = process.env.VIGIL_VIDEO_RPC ?? (FORK ? "http://127.0.0.1:8546" : "robinhood_testnet");
const URL_ = process.env.VIGIL_VIDEO_URL ?? (FORK ? "http://127.0.0.1:5179/vigil/?poll=3000&rpc=http://127.0.0.1:8546" : "https://mdlog.github.io/vigil/?poll=4000");
const TITLE_MS = 5000;
const TAIL_MS = 8000;
const EXPLORER_MS = 7000;
const END_MS = 5000;
const TERMINAL_W = 740;
const CHAIN_ID = 46630;

const TERMINAL_HTML = fs.readFileSync(path.join(VIDEO_DIR, "terminal.html"), "utf8");
// Chart cards embed the calibrator's PNGs as data URIs: the cards load as an iframe srcdoc, where relative paths do not resolve.
const CARDS_HTML = fs.readFileSync(path.join(VIDEO_DIR, "cards.html"), "utf8").replace(/\{\{img:([\w.-]+)\}\}/g, (_, f: string) => {
  const png = path.join(REPO, "calibrator", "out", f);
  if (!fs.existsSync(png)) throw new Error(`card image missing: ${png} — run the calibrator first`);
  return `data:image/png;base64,${fs.readFileSync(png).toString("base64")}`;
});
const FORGE_CMD = `forge script script/E2E.s.sol --rpc-url ${RPC} --broadcast --slow --gas-estimate-multiplier 200 -vv`;

type Mark = { id: string; atS: number };

const ansi = /\x1b\[[0-9;?]*[A-Za-z]/g;
const strip = (s: string) => s.replace(ansi, "").replace(/[⠁⠂⠄⡀⢀⠠⠐⠈⠉⠙⠚⠞⠖⠦⠴⠲⠳⠓⠋]/g, "").trim();

async function dockTerminal(page: Page) {
  await page.evaluate(
    async ({ html, w }) => {
      const st = document.createElement("style");
      st.textContent = `#app{max-width:1150px;margin:0 0 0 16px} body{padding-right:${w}px}`;
      document.head.appendChild(st);
      const f = document.createElement("iframe");
      f.id = "__term";
      f.style.cssText = `position:fixed;top:0;right:0;width:${w}px;height:100vh;border:0;z-index:2147483645;background:#0b0f17;`;
      f.srcdoc = html;
      document.documentElement.appendChild(f);
      await new Promise((r) => (f.onload = r));
    },
    { html: TERMINAL_HTML, w: TERMINAL_W },
  );
}

async function term(page: Page, line: string) {
  await page.evaluate((l) => {
    const f = document.getElementById("__term") as HTMLIFrameElement | null;
    (f?.contentWindow as unknown as { push?: (s: string) => void })?.push?.(l);
  }, line);
}

async function card(page: Page, name: string) {
  await page.evaluate(
    async ({ html, name }) => {
      document.getElementById("__overlay")?.remove();
      const f = document.createElement("iframe");
      f.id = "__overlay";
      f.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483646;background:#07090f;";
      f.srcdoc = html;
      document.documentElement.appendChild(f);
      await new Promise((r) => (f.onload = r));
      await (f.contentWindow as unknown as { render: (o: { card: string }) => Promise<void> }).render({ card: name });
    },
    { html: CARDS_HTML, name },
  );
}

async function clearOverlay(page: Page) {
  await page.evaluate(() => document.getElementById("__overlay")?.remove());
}

/** One 1920×1080 PNG per static card (opening/closing beats) — off camera, so they can be re-shot without a take. */
async function shootCards(browser: Browser): Promise<string[]> {
  const dir = path.join(OUT_DIR, "cards");
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.setContent(CARDS_HTML, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const shots: string[] = [];
  for (const b of [...OPENING, ...CLOSING]) {
    await page.evaluate((name) => (window as unknown as { render: (o: { card: string }) => Promise<void> }).render({ card: name }), b.card);
    const missing = await page.evaluate((name) => {
      const el = document.getElementById(name);
      if (!el) return `card #${name} not in cards.html`;
      const img = el.querySelector("img");
      return img && !(img.complete && img.naturalWidth > 0) ? `image of #${name} did not load` : null;
    }, b.card);
    if (missing) throw new Error(missing);
    const file = path.join(dir, `${b.card}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
  }
  await ctx.close();
  return shots;
}

async function view(page: Page, v: View) {
  await page.evaluate((v) => {
    if (v === "hero") window.scrollTo({ top: 0, behavior: "smooth" });
    else document.querySelector(v === "economy" ? "#economy" : "#price")?.scrollIntoView({ behavior: "smooth", block: v === "economy" ? "center" : "start" });
  }, v);
}

/** Refuse to film a page that is not live. */
async function liveOrThrow(page: Page) {
  const badge = page.locator(".badge-text");
  try {
    await badge.filter({ hasText: "live" }).waitFor({ timeout: 30_000 });
  } catch {
    console.warn("  dashboard not live after 30s — reloading once");
    await page.reload({ waitUntil: "load" });
    await badge.filter({ hasText: "live" }).waitFor({ timeout: 30_000 });
  }
  const bad = await page.evaluate(() => {
    const t = document.body.innerText;
    return t.includes("RPC unreachable") ? "RPC unreachable" : t.includes("reverting") ? "oracle reverting" : null;
  });
  if (bad) throw new Error(`not filmable: page shows "${bad}"`);
}

async function captureExplorer(browser: Browser, hash: string): Promise<string | null> {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  const shot = path.join(OUT_DIR, "explorer.png");
  try {
    await page.goto(`${EXPLORER}/tx/${hash}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.getByText(hash.slice(0, 10)).first().waitFor({ timeout: 40_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shot });
    return shot;
  } catch (e) {
    console.warn(`  explorer capture failed (${e instanceof Error ? e.message.split("\n")[0] : e}); the take holds on the dashboard instead`);
    return null;
  } finally {
    await ctx.close();
  }
}

/**
 * forge prints per-transaction receipts only on a TTY, and `script` block-buffers
 * its stdout when that is a pipe — so forge runs under `script -f`, which flushes
 * every write to a typescript file, and the file is tailed as it grows.
 */
function runForge(onLine: (l: string) => Promise<void>): Promise<number> {
  return new Promise((resolve, reject) => {
    const ptyLog = path.join(OUT_DIR, "forge.pty.log");
    fs.writeFileSync(ptyLog, "");
    const child = spawn("script", ["-qfc", FORGE_CMD, ptyLog], { cwd: REPO, env: process.env, stdio: ["ignore", "ignore", "ignore"] });
    let offset = 0;
    let buf = "";
    let chain = Promise.resolve();
    let closed = false;
    let code: number | null = null;
    const drain = () => {
      const size = fs.statSync(ptyLog).size;
      if (size > offset) {
        const fd = fs.openSync(ptyLog, "r");
        const b = Buffer.alloc(size - offset);
        fs.readSync(fd, b, 0, b.length, offset);
        fs.closeSync(fd);
        offset = size;
        buf += b.toString("utf8");
        const parts = buf.split(/\r\n|\n|\r/);
        buf = parts.pop() ?? "";
        for (const p of parts) {
          const line = strip(p);
          if (line) chain = chain.then(() => onLine(line));
        }
      }
    };
    const timer = setInterval(() => {
      try {
        drain();
      } catch (e) {
        clearInterval(timer);
        reject(e);
        return;
      }
      if (closed) {
        clearInterval(timer);
        const last = strip(buf);
        chain = chain.then(async () => {
          if (last) await onLine(last);
        });
        chain.then(() => resolve(code ?? 1)).catch(reject);
      }
    }, 150);
    child.on("error", (e) => {
      clearInterval(timer);
      reject(e);
    });
    child.on("close", (c) => {
      code = c;
      closed = true;
    });
  });
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  const plan = BEATS;
  if (!CARDS_ONLY) await fetch(URL_, { signal: AbortSignal.timeout(30_000) }).then((r) => r.arrayBuffer()).catch(() => {});

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    ...(PROBE || CARDS_ONLY ? {} : { recordVideo: { dir: RAW, size: { width: 1920, height: 1080 } } }),
  });
  const shots = await shootCards(browser);
  console.log(`  ${shots.length} cards → out/cards/`);
  if (CARDS_ONLY) {
    await context.close();
    await browser.close();
    return;
  }
  const page = await context.newPage();
  const t0 = Date.now();
  const elapsedS = () => (Date.now() - t0) / 1000;
  const marks: Mark[] = [];
  const mark = (id: string) => {
    marks.push({ id, atS: Number(elapsedS().toFixed(2)) });
    console.log(`  ${elapsedS().toFixed(1).padStart(6)}s  ${id}`);
  };

  await page.goto(URL_, { waitUntil: "load", timeout: 30_000 });
  await liveOrThrow(page);
  await dockTerminal(page);
  await card(page, "title");
  mark("00-title");
  await page.waitForTimeout(PROBE ? 600 : TITLE_MS);
  await clearOverlay(page);

  const log: string[] = [];
  const hashes: string[] = [];
  const held = new Map<number, string>();
  const summary: string[] = [];
  const released = new Set<number>();
  let inSummary = false;
  let failed = false;

  /** Releases every phase up to `phase` that has not been shown yet, in order. */
  const release = async (phase: number) => {
    for (let p = 0; p <= phase; p++) {
      if (released.has(p)) continue;
      released.add(p);
      const line = held.get(p);
      if (line) await term(page, line);
      const beat = plan.find((b) => b.startsAt === p);
      if (beat) {
        mark(beat.id);
        await view(page, beat.view);
      }
    }
  };

  let sent = -1; // highest transaction index forge reported as "Sending"
  const onLine = async (line: string) => {
    log.push(line);
    if (/^\[E2E\] phase (\d+)/.test(line)) {
      held.set(Number(RegExp.$1), line);
      return;
    }
    if (/^=== E2E SUMMARY/.test(line)) {
      inSummary = true;
      summary.push(line);
      return;
    }
    if (inSummary) {
      if (/^(oracle price|feed during|closure length|bob |erin |suppliers|backstop|unwind)/.test(line)) {
        summary.push(line);
        return;
      }
      inSummary = false; // first non-summary line ends the block; fall through
    }
    if (/^\[E2E\] actor/.test(line) || /^Chain \d+/.test(line) || /^Estimated total gas/.test(line)) {
      await term(page, line);
      return;
    }
    // The progress line is redrawn in place, so one captured line may hold several frames: take the highest index.
    const frames = [...line.matchAll(/Sending transactions \[(\d+) - (\d+)\]/g)];
    if (frames.length) {
      const k = Math.max(...frames.map((m) => Number(m[1])));
      if (k > sent) {
        sent = k;
        await release(phaseAt(k + 1));
        await term(page, `Sequence #1 on ${CHAIN_ID} | Sending transactions [${k} - ${k}]`);
      }
      return;
    }
    // With --slow, forge sends transaction n+1 only after receipt n: a receipt is the reliable clock.
    const h = /\[Success\] Hash: (0x[0-9a-f]{64})/i.exec(line);
    if (h) {
      hashes.push(h[1]);
      await term(page, line);
      if (hashes.length < TX_TOTAL) await release(phaseAt(hashes.length + 1));
      else await release(TX_PLAN[TX_PLAN.length - 1].phase);
      return;
    }
    if (/^Block: \d+/.test(line)) {
      await term(page, line);
      return;
    }
    if (/ONCHAIN EXECUTION COMPLETE/.test(line)) {
      for (const s of summary) await term(page, s);
      await term(page, line);
      return;
    }
    if (/Error|Transaction Failure|Revert/.test(line)) {
      failed = true;
      await term(page, line);
    }
  };

  if (PROBE) {
    for (const p of TX_PLAN) await term(page, `[probe] phase ${p.phase} ${p.name}: ${p.txs} tx`);
    await page.waitForTimeout(400);
    for (const b of plan) {
      if (typeof b.startsAt === "number") {
        mark(b.id);
        await view(page, b.view);
        await page.waitForTimeout(400);
      }
    }
    await card(page, "end");
    await page.waitForTimeout(400);
    await context.close();
    await browser.close();
    console.log("probe ok: page live, terminal docked, views scroll, cards render");
    return;
  }

  console.log(`▶ ${FORGE_CMD}`);
  const code = await runForge(onLine);
  if (code !== 0 || failed) {
    await context.close();
    await browser.close();
    fs.writeFileSync(path.join(OUT_DIR, "e2e.log"), log.join("\n") + "\n");
    throw new Error(`forge exited ${code}${failed ? " with a failure line" : ""} — see out/e2e.log; nothing was cut`);
  }
  if (hashes.length !== TX_TOTAL) {
    console.warn(`  expected ${TX_TOTAL} confirmations, saw ${hashes.length} — TX_PLAN in script.ts may be stale`);
  }
  // Let the dashboard poll the final state before the summary shots.
  await page.waitForTimeout(TAIL_MS);
  const coverTx = hashes[COVER_TX_ORDINAL - 1];
  const shot = coverTx ? await captureExplorer(browser, coverTx) : null;
  if (shot) {
    mark("explorer");
    const png = fs.readFileSync(shot).toString("base64");
    await page.evaluate((src) => {
      const img = document.createElement("img");
      img.id = "__overlay";
      img.src = src;
      img.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483646;object-fit:cover;";
      document.documentElement.appendChild(img);
    }, `data:image/png;base64,${png}`);
    await page.waitForTimeout(EXPLORER_MS);
    await clearOverlay(page);
  }
  await card(page, "end");
  mark("end");
  await page.waitForTimeout(END_MS);
  const durationS = elapsedS();
  const video = page.video();
  await context.close();
  await browser.close();
  const raw = await video!.path();
  fs.renameSync(raw, path.join(RAW, "take.webm"));
  fs.writeFileSync(path.join(OUT_DIR, "e2e.log"), log.join("\n") + "\n");
  fs.writeFileSync(
    path.join(OUT_DIR, "timeline.json"),
    JSON.stringify({ recordedAt: new Date(t0).toISOString(), url: URL_, rpc: RPC, durationS: Number(durationS.toFixed(2)), marks, hashes, coverTx }, null, 1),
  );
  console.log(`\nrecorded ${durationS.toFixed(1)}s → out/raw/take.webm, ${hashes.length} confirmations, ${marks.length} marks`);
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
