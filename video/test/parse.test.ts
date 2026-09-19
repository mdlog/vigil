import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BEATS, CLOSING, COVER_TX_ORDINAL, OPENING, ORDER, TX_TOTAL, narration, phaseAt } from "../script.ts";

// Replays the recorder's line classification over a captured forge log.
const LOG = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "out", "e2e.log");

test("captured log yields every phase line, the summary and 37 receipts", { skip: !fs.existsSync(LOG) && "no out/e2e.log" }, () => {
  const lines = fs.readFileSync(LOG, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const phases = lines.filter((l) => /^\[E2E\] phase (\d+)/.test(l));
  assert.equal(phases.length, 10);
  assert.ok(lines.some((l) => /^=== E2E SUMMARY/.test(l)));
  const hashes = lines.filter((l) => /\[Success\] Hash: 0x[0-9a-f]{64}/i.test(l));
  assert.equal(hashes.length, TX_TOTAL);
  const frames = lines.flatMap((l) => [...l.matchAll(/Sending transactions \[(\d+) - (\d+)\]/g)].map((m) => Number(m[1])));
  assert.equal(Math.max(...frames), TX_TOTAL - 1);
  assert.equal(phaseAt(TX_TOTAL), 9);
});

test("the explorer shot is the first liquidateWithCover (phase 8 = approve, cover, cover)", () => {
  assert.equal(COVER_TX_ORDINAL, 35);
  assert.equal(phaseAt(COVER_TX_ORDINAL), 8);
});

test("summary block is the eleven result rows", { skip: !fs.existsSync(LOG) && "no out/e2e.log" }, () => {
  const lines = fs.readFileSync(LOG, "utf8").split("\n").map((l) => l.trim());
  const start = lines.findIndex((l) => /^=== E2E SUMMARY/.test(l));
  const rows = [];
  for (const l of lines.slice(start + 1)) {
    if (/^(oracle price|feed during|closure length|bob |erin |suppliers|backstop|unwind)/.test(l)) rows.push(l);
    else break;
  }
  assert.equal(rows.length, 11);
});

test("narration order is opening cards → take beats → closing cards, every id narratable", () => {
  assert.deepEqual(ORDER.slice(0, OPENING.length), OPENING.map((b) => b.id));
  assert.deepEqual(ORDER.slice(OPENING.length, OPENING.length + BEATS.length), BEATS.map((b) => b.id));
  assert.deepEqual(ORDER.slice(-CLOSING.length), CLOSING.map((b) => b.id));
  assert.equal(new Set(ORDER).size, ORDER.length);
  assert.equal(CLOSING[CLOSING.length - 1].card, "end");
  const TAKE = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "out", "take.json");
  if (fs.existsSync(TAKE)) {
    const take = JSON.parse(fs.readFileSync(TAKE, "utf8")) as Parameters<typeof narration>[1];
    for (const id of ORDER) assert.ok(narration(id, take).length > 20, id);
  }
});
