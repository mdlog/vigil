# Vigil ops — the keeper

The off-chain side of a live Vigil market, in one file (`keeper.ts`, ~230 lines, viem, no database). Every
command reads the deployment manifest and the compiled ABIs, prints what it sees or would do, and sends nothing
unless `--send` is given.

| Command | What it does | Who may run it | Pays |
|---|---|---|---|
| `status` | regime, feed usability, oracle price and haircut, premium-index lag, backstop, market totals, every borrower (collateral, debt, LTV, membership, unwindable, shortfall) | anyone (read-only) | — |
| `poke` | `VigilSessionOracle.poke(asset)` when the premium index has not been persisted for `--max-lag-hours` (default 6) | anyone; the poke bounty refunds it | gas |
| `unwind` | `VigilPreLiquidation.preLiquidate` on every member `isUnwindable` reports, at `currentDiscountBps` | anyone with USDG | USDG (gets collateral at a discount) |
| `liquidate` | `VigilLossReporter.liquidateWithCover` on every position that is unhealthy at the oracle price; the backstop covers the shortfall | anyone with USDG | USDG (gets collateral + Morpho's incentive) |
| `attest` | signs an EIP-712 attestation with the keeper-signer key and submits it: a halt or a delayed open, tightening only | the `keeperSigner` role | gas |

```bash
cd ops && npm ci && (cd .. && forge build)        # ABIs are read from ../out

npm run keeper -- status                            # testnet v4 manifest by default
npm run keeper -- status --manifest deployments/robinhood-mainnet-4663.json --strict   # exit 1 on an alert
npm run keeper -- liquidate                         # dry run: prints every call it would make
OPS_PRIVATE_KEY=0x… npm run keeper -- liquidate --send
OPS_PRIVATE_KEY=0x… npm run keeper -- unwind --send --loop 300      # every 5 minutes, forever
OPS_PRIVATE_KEY=0x… npm run keeper -- attest --regime CLOSED --next-open +2h --send   # delay Monday's open by 2 h
OPS_PRIVATE_KEY=0x… npm run keeper -- attest --regime CLOSED --close-at now --next-open +1h --send   # halt now
npm run keeper -- status --rpc http://127.0.0.1:8545                # against an Anvil fork
```

Flags: `--manifest <path>` (or `MANIFEST`), `--rpc <url>` (or `RPC_URL`, default the manifest's), `--send`,
`--loop <seconds>`, `--verbose` (full viem error report instead of the one-line reason), `--strict` (status only).
`attest` takes `--regime EXTENDED|OVERNIGHT|CLOSED`, `--close-at` and `--next-open` as `now`, `+2h`, `+30m` or unix
seconds (default: the calendar's values), `--deadline-minutes` (default 20; the contract refuses anything over 30).

## What the contracts enforce, so the keeper does not have to

- An attestation can only **tighten**: `closeAt` may move earlier, `nextOpen` later, never the reverse; a halt must
  name a closed regime; `CORP_ACTION` cannot be attested; every attestation carries `issuedAt` (must not be ahead of
  the chain, must be newer than the last one) and a `deadline` ≤ 30 minutes out. A stolen keeper key can make the
  market more conservative, not less.
- `poke` is permissionless and paid by the bounty; `unwind` and `liquidate` are permissionless and paid by the
  discount / incentive. Running several keepers in parallel is safe: the second one finds nothing to do or reverts.
- The oracle fails closed when the feed is stale for the session; then `liquidate` (and Morpho) cannot price and the
  keeper says so instead of retrying.

`status --strict` is meant for a scheduler (cron, GitHub Actions): it exits 1 on *feed not usable*, *oracle
reverting*, *index not persisted for 24 h*, *uncovered shortfall* or *liquidatable position*.

## Keys

`OPS_PRIVATE_KEY` is read from the environment only. `poke`/`unwind`/`liquidate` can use any funded key; `attest`
needs the key behind `VigilSessionOracle.keeperSigner()` (`script/Handover.s.sol` sets it). Keep it hot and small:
gas plus a USDG float for unwinds; the guardian and calibrator keys never touch this machine.

## Tests

`npm test` covers the pure math (`lib.ts`): Morpho's share-to-debt rounding and health check bit-exact with
`SharesMathLib` / `Morpho._isHealthy`, the time grammar and the error formatter. Everything else was exercised
against an Anvil fork of the testnet deployment (`anvil --fork-url https://rpc.testnet.chain.robinhood.com`):
`unwind` repaid a member at the session discount, `liquidateWithCover` covered a real shortfall, `attest` delayed an
open and was refused (`NotTightening`) when asked to loosen.
