import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TX_TOTAL, phaseAt } from "../script.ts";

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
