import { test } from "node:test";
import assert from "node:assert/strict";
import { debtOf, isHealthy, ltvBps, maxBorrowOf, parseWhen, shortError } from "../lib.ts";

test("debtOf rounds up like SharesMathLib.toAssetsUp", () => {
  assert.equal(debtOf(0n, 0n, 0n), 0n);
  assert.equal(debtOf(1n, 0n, 0n), 1n); // one share of nothing still owes 1 wei: mulDivUp through the virtual offsets
  // 100 USDG borrowed in one go: 100e6 assets ↔ 100e6 * 1e6 shares (the offsets cancel to the wei)
  const shares = 100_000_000n * 1_000_000n;
  assert.equal(debtOf(shares, 100_000_000n, shares), 100_000_000n);
  // interest accrued: 110 USDG owed by the same shares
  assert.equal(debtOf(shares, 110_000_000n, shares), 110_000_000n);
});

test("isHealthy matches Morpho._isHealthy at the boundary", () => {
  const price = 211_341_251_223_506_966_972_919_979n; // 211.34 USDG per NVDA, 36-decimal oracle scale (18d coll, 6d loan)
  const lltv = 860_000_000_000_000_000n; // 0.86
  const coll = 150_000_000_000_000_000n; // 0.15 NVDA
  const max = maxBorrowOf(coll, price, lltv);
  assert.equal(max, 27_263_020n); // 0.15 * 211.34 * 0.86 = 27.263 USDG, rounded down twice like Morpho
  assert.equal(isHealthy(coll, price, lltv, max), true);
  assert.equal(isHealthy(coll, price, lltv, max + 1n), false);
  assert.equal(ltvBps(coll, price, max), 8599); // just under 86 %
});

test("parseWhen understands now, +Nh, +Nm and unix seconds", () => {
  assert.equal(parseWhen(undefined, 100, 5), 100);
  assert.equal(parseWhen("now", 100, 5), 5);
  assert.equal(parseWhen("+2h", 100, 5), 7300);
  assert.equal(parseWhen("+30m", 100, 5), 1900);
  assert.equal(parseWhen("1790000000", 100, 5), 1_790_000_000);
  assert.throws(() => parseWhen("tomorrow", 100, 5), /cannot parse/);
});

test("shortError keeps the revert reason", () => {
  const e = Object.assign(new Error("long"), {
    shortMessage: "The contract function \"attest\" reverted.",
    metaMessages: ["Error: StaleAttestation()", "Contract Call:", "  address: 0x…"],
  });
  assert.equal(shortError(e), "The contract function \"attest\" reverted. — Error: StaleAttestation()");
  assert.equal(shortError(new Error("plain")), "plain");
});
