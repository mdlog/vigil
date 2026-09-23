# Audit scope — Vigil

Prepared for an external review before the mainnet launch described in `docs/MAINNET.md`. Commit: the one
this file was added in (`git log -1 -- docs/AUDIT_SCOPE.md`). No external audit has been performed yet.

## What Vigil is, in one paragraph

A set of eight immutable contracts that sit next to an unmodified Morpho Blue market whose collateral is a
tokenized equity (Robinhood's ERC-8056 stock tokens) and whose loan token is USDG. The underlying equity trades
24/5 and its Chainlink feed stops for the weekend (Friday evening → Sunday 20:00 ET), while the token, the chain
and the market run 24/7. Vigil derives the exchange
session from `block.timestamp`, applies a haircut to the oracle price that ramps up during a closure and
releases at the open, charges a premium for holding a leveraged position through a closure, unwinds
consenting members softly before the open, and keeps a first-loss backstop that repays a shortfall inside
the liquidation transaction so the market's suppliers never absorb bad debt from a gap. Everything is
derived from time, the feed and the token; off-chain actors can only make the system more conservative.

## In scope

`src/` at 1,937 lines (solc 0.8.19, `paris`, optimizer 200 runs, OpenZeppelin 4.9.6, Morpho Blue v1.0.0):

| Contract | Lines | Role | External entry points |
|---|---|---|---|
| `VigilCalendar` | 183 | NYSE session from `block.timestamp` (ET with DST, holidays, half days), add-only | `addHoliday`, `setGuardian` |
| `VigilSessionOracle` | 412 | effective regime = max(calendar, feed staleness, keeper attestation, token corporate action); premium index accrual; poke bounty | `attest`, `poke`, `fundBounty`, `registerAsset`, `setRiskEngine`, `setRoles`, `setPokeBounty` |
| `VigilRiskEngine` | 340 | haircut surface H(L) with ramp, scheduled events (earnings), premium and buffer tables; rate-limited calibration | `setSurface`, `scheduleEvent`, `setPremiumTables`, `setRoles` |
| `VigilOracle` | 102 | Morpho `IOracle`: feed × (1 − min(H, cap)), USDG/USD quote leg, fails closed on staleness | `price` (view) |
| `VigilPremium` | 254 | USDG escrow per borrower; membership = escrow ≥ accrued premium + buffer | `topUp`, `withdrawUnused`, `accrue`, `registerMarket`, `setPreLiquidation`, `transferGuardian` |
| `VigilBackstop` | 145 | ERC-4626 first-loss tranche; exit only via request → 7-day cooldown → claim during `MARKET`; per-market coverage cap | `deposit`/`mint`, `requestWithdraw`, `claimWithdraw`, `coverBadDebt` (loss reporter only), `setCoverageCap`, `setLossReporter`, `transferGuardian` |
| `VigilPreLiquidation` | 187 | session-aware soft unwind of members to a target LTV at a regime-dependent discount (Morpho PreLiquidation pattern) | `preLiquidate`, `registerMarket`, `transferGuardian` |
| `VigilLossReporter` | 209 | `liquidateWithCover`: computes the shortfall at the oracle price, draws it from the backstop, repays on behalf, then runs Morpho's liquidation | `liquidateWithCover`, `onMorphoLiquidate` (Morpho callback), `registerMarket`, `transferGuardian` |
| `interfaces/` | 105 | `IVigil` (types, events, errors), `IAggregatorV3`, `IStockToken` (ERC-8056 subset) | — |
| `periphery/VigilMigrator` | 64 | moves a supply position between two markets of the same Morpho in one call; grants the withdrawal authorisation from the caller's EIP-712 signature; holds nothing between transactions | `migrate` |

Deployment wiring is in `script/Deploy.s.sol` and `script/DeployLib.sol` (calibrated parameters); they are
in scope for *what they set*, not as code that runs after deployment.

## Out of scope

`src/mocks/*`, `test/*`, `script/Demo.s.sol`, `script/E2E.s.sol`, the calibrator (Python), the dashboard
(`web/`), the keeper (`ops/`), the video pipeline. Morpho Blue, OpenZeppelin, Chainlink feeds, Paxos USDG and
Robinhood's stock tokens are dependencies, assumed correct as deployed.

## Trust model

| Actor | Can | Cannot |
|---|---|---|
| `guardian` (per contract; one address after handover) | add holidays / half days ≥ 7 days ahead; register assets and markets; wire the loss reporter and pre-liquidation once; set the coverage cap and the poke bounty; transfer its role | remove a holiday; change a price, a haircut or a table; pause; block or force a liquidation; touch escrowed or deposited funds |
| `calibrator` | move the surface within `MAX_DELTA_BPS` = 200 bps per update and the on-chain bounds; schedule events; set premium tables | exceed the bounds; act on the oracle directly |
| `keeperSigner` | sign attestations that tighten: an earlier `closeAt`, a later `nextOpen` (≤ `MAX_CLOSED_HORIZON` = 5 days), regime ≤ `CLOSED`, life ≤ `MAX_ATTESTATION_AGE` = 30 min, strictly increasing `issuedAt` | loosen; attest `CORP_ACTION`; make the oracle revert |
| the stock token (ERC-8056, plus Robinhood's `oraclePaused()`) | put the asset into `CORP_ACTION` through `oraclePaused()` / the `effectiveAt` window | — |
| the feed | make the oracle fail closed by going stale | move the price outside Chainlink's own bounds |
| anyone | `poke`, `preLiquidate` a member reported unwindable, `liquidateWithCover` an unhealthy position, deposit into the backstop, top up an escrow | — |

The deployer holds every role until `script/Handover.s.sol` is run; the runbook keeps the coverage cap at 0
until then.

## Properties we claim (and test)

Fuzzed by `test/invariants/Invariants.t.sol` (48 runs × depth 24 in CI, `fail_on_revert = false`) and
regression-pinned in `RegressionSequences.t.sol`:

- **INV-1** the effective regime is never looser than the calendar's.
- **INV-3** with a constant feed, the oracle price never *decreases* by a step: every decrease is a ramp bounded by the surface's rate (increases, i.e. releases, may be instantaneous).
- **INV-4** the haircut is bounded: `H_floor ≤ H ≤ H_max` in the engine and `≤ MARKET_HAIRCUT_CAP_BPS` (500) at the oracle.
- **INV-7** the premium index view is monotone non-decreasing and a lower bound of the persisted index.
- **INV-11** `CORP_ACTION` only ever originates from the stock token.
- **INV-12** the soft-unwind threshold is always tighter than the hard liquidation threshold.
- closures are bounded by `MAX_CLOSED_HORIZON`.

Scenario tests (`test/scenarios/Scenarios.t.sol`) replay 5 Aug 2024 and 27 Jan 2025 for NVDA against a
control market with a plain feed oracle; the fork suite (`test/fork/MainnetFork.t.sol`) runs the weekend
cycle on a Robinhood Chain mainnet fork against the real Morpho, USDG, NVDA token and Chainlink feeds. 80
tests plus the 3 fork tests; line coverage ≈ 93 % on `src/`.

## Assumptions an auditor should try to break

1. **Time.** Everything is `block.timestamp`; `block.number` is never used (an L1 estimate on Nitro). The
   calendar's ET conversion and DST rules are pinned 2022–2030 against `zoneinfo` and NYSE's published
   calendar 2024–2028. Sequencer downtime is not modelled (no uptime feed exists on the chain, `SEQ_UPTIME_FEED
   = 0`); what happens if the chain stalls across an open?
2. **Feed freshness rules.** Inside `MARKET` staleness is measured from `max(updatedAt, lastOpen)` with a 6 h
   window; outside it the feed is usable while `updatedAt + 18 h ≥ closeAt`. Is there a sequence of feed
   updates (a late Friday tick, a holiday Monday, an early close) that lets a stale price through, or that
   fails closed when it should not?
3. **Ramp arithmetic.** `h = h_cal + (H_tight − h_cal) · f` with `f` ramping from the tightening's start;
   consecutive attestations share the start. Look for a step in the price on any regime transition,
   attestation refresh or expiry, event start or end (INV-3 is the property).
4. **Premium accrual.** The index integrates a rate over time segments (`MAX_SEGMENTS` = 128 per poke);
   attestations are accrued over `[issuedAt, issuedAt + 30 min)` even after expiry; derived tightenings
   (stale feed, corporate action) are persisted only when a `poke` observes them. Can the view exceed the
   persisted value, or can membership flip without a state change?
5. **Cover path.** `liquidateWithCover` computes `maxRepayable` at the oracle price and the liquidation
   incentive factor, draws `shortfall + DUST` (0.001 USDG) from the backstop, repays on behalf, then calls
   Morpho's `liquidate` and receives the callback. Rounding: can a full seizure still leave bad debt for
   Morpho to socialise? Can the reporter be made to draw cover for a healthy position, or twice for one?
6. **Backstop exits.** Request → 7-day cooldown → claim only during `MARKET`, converted at the share price
   at claim time. Can a depositor front-run a loss (exit before a Monday gap they can see coming)? The design
   answer is that every exit crosses a weekend; check the boundary at 09:30 ET.
7. **Soft unwind.** `preLiquidate` is only possible for members, only when `isUnwindable`, only down to the
   target LTV, at `currentDiscountBps`. Can it be used to grief a member (repeated partial unwinds), or to
   extract more than the discount?
8. **ERC-8056.** `uiMultiplier` / `newUIMultiplier` / `effectiveAt` drive the corporate-action window and the
   price conversion; `oraclePaused()`, Robinhood's own extension rather than part of ERC-8056, is probed at
   registration (the testnet token lacks it). A token whose
   multiplier changes without announcing a window — what does the oracle return?
9. **Token restrictions.** USDG can freeze addresses; the stock token's registry can block them. Which
   frozen/blocked party can brick which function (e.g. a blocked loss reporter, a frozen backstop)?
10. **Role transitions.** `setRoles` / `transferGuardian` are one-step. `setLossReporter` and
    `setPreLiquidation` are guardian-only but not one-shot — should they be?
11. **Reentrancy.** The loss reporter is the only contract that calls out to Morpho and receives a callback;
    the premium escrow and the backstop transfer USDG. USDG is an EIP-1967 proxy — no hooks are assumed.

## How to run

```bash
forge build --sizes && forge test -vvv
forge coverage --report summary --no-match-coverage "(test|script|mocks)"
FOUNDRY_PROFILE=fork FOUNDRY_FORK_TESTS=1 forge test --match-path test/fork/MainnetFork.t.sol -vv   # needs the mainnet RPC
forge lint
```

Known lints: `unsafe-typecast` on casts that are guarded at the call site (`answer > 0`, day index < 2³²,
USDG amounts < 2¹²⁸).

## Contacts and disclosure

Report findings privately to the maintainer named in `README.md › License`; the deployment on mainnet will not
accept a coverage cap above 0 until the findings of this review are addressed.
