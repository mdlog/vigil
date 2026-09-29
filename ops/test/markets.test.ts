import { test } from "node:test";
import assert from "node:assert/strict";
import { alertsOf, marketsOf } from "../lib.ts";

const single = {
  market: { id: "0x" + "11".repeat(32), collateralSymbol: "TSLA" },
  contracts: { StockToken: { address: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E" }, VigilOracle: { address: "0x79DA01DB22808E3A7397B788F171a7647b1bEf8f" }, MockFeed: { address: "0x87ae00000000000000000000000000000049c300" } },
};
const multi = { ...single, markets: [
  { symbol: "TSLA", id: "0x" + "11".repeat(32), stock: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E", oracle: "0x79DA01DB22808E3A7397B788F171a7647b1bEf8f", feed: "0x87ae00000000000000000000000000000049c300" },
  { symbol: "AMD", id: "0x" + "22".repeat(32), stock: "0x71178BAc73cBeb415514eB542a8995b82669778d", oracle: "0x0000000000000000000000000000000000000a11", feed: "0x0000000000000000000000000000000000000f11" },
] };

test("an older manifest has its one market", () => {
  assert.deepEqual(marketsOf(single).map((m) => m.symbol), ["TSLA"]);
});
test("markets[] in order, filtered by --market case-insensitively", () => {
  assert.deepEqual(marketsOf(multi).map((m) => m.symbol), ["TSLA", "AMD"]);
  assert.deepEqual(marketsOf(multi, "amd").map((m) => m.symbol), ["AMD"]);
  assert.throws(() => marketsOf(multi, "XYZ"), /unknown market XYZ/);
});
test("alerts carry the ticker", () => {
  assert.deepEqual(alertsOf("AMD", { usable: true, price: 1n, lagSeconds: 3600n, uncovered: false, liquidatable: false }), []);
  assert.deepEqual(alertsOf("AMD", { usable: false, price: null, lagSeconds: 90_000n, uncovered: false, liquidatable: false }),
    ["AMD: feed not usable", "AMD: oracle reverting", "AMD: premium index not persisted for 24 h"]);
});
