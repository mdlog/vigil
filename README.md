# Vigil

[![CI](https://github.com/mdlog/vigil/actions/workflows/test.yml/badge.svg)](https://github.com/mdlog/vigil/actions/workflows/test.yml)
[![Solidity 0.8.19](https://img.shields.io/badge/solidity-0.8.19-363636?logo=solidity)](foundry.toml)
[![Built with Foundry](https://img.shields.io/badge/built%20with-Foundry-FFDB1C)](https://getfoundry.sh/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Session-aware collateral risk layer for tokenized equity on Morpho Blue — built for Robinhood Chain.**

> Robinhood Chain (Arbitrum Nitro) runs 24/7. Chainlink equity price feeds run 24/5 and **freeze for the whole
> weekend**. In four years of NVDA data, both gaps that would have produced bad debt in an 86 % LLTV market
> happened at **Monday open** (5 Aug 2024 −14.2 %, 27 Jan 2025 −12.5 %). Utilization-based interest curves
> charged nothing for either. Vigil turns that risk into a number — a haircut ramped in before the close, a
> premium paid into a first-loss tranche, a soft unwind while liquidity still exists — without touching
> Morpho's core.

## Table of contents

- [The problem](#the-problem)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Demo: replaying two real Mondays](#demo-replaying-two-real-mondays)
- [Getting started](#getting-started)
- [Deployment](#deployment)
- [Default parameters](#default-parameters)
- [Roles and trust assumptions](#roles-and-trust-assumptions)
- [Design notes](#design-notes)
- [On-chain verification](#on-chain-verification)
- [Project structure](#project-structure)
- [Status and roadmap](#status-and-roadmap)
- [Contributing](#contributing)
- [Contributors](#contributors)
- [License](#license)

## The problem

Tokenized equities on Robinhood Chain (ERC-8056 stock tokens such as NVDA, AAPL, TSLA) can be used as
collateral in Morpho Blue markets. Every week, for roughly 65 hours (Friday 16:00 → Monday 09:30 ET), there
is no liquid regular session and the on-chain price feed does not move. Any Monday-open gap therefore hits a
position at the *Friday* price, with no intermediate price at which a partial liquidation could have saved
it. Lenders are effectively writing a free option, and a utilization-based interest rate model has no way
to see it.

## How it works

Vigil is not a lending protocol. It attaches to an **unmodified** Morpho Blue market through three points:

| Attachment point | What Vigil does |
|---|---|
| **Oracle** (`IOracle`) | Effective collateral value falls as a function of the *duration of the closure* being entered — derived from an on-chain exchange calendar and ramped over time, never stepped. |
| **Premium** | Borrowers who opt in pay a *session premium* in USDG on top of the market's interest, accrued from an on-chain index. |
| **Backstop** | An ERC-4626 first-loss tranche in USDG receives the premiums and absorbs shortfalls that arise while the market is closed. |

Members (borrowers who pay the premium) additionally get a **soft unwind** — a session-aware, time-based
Dutch partial pre-liquidation that runs *before* the weekend, while the collateral can still be sold — and
**loss coverage**: `liquidateWithCover` lets the backstop repay a member's shortfall in the same transaction as
the seizure, so Morpho never realizes bad debt and suppliers are kept whole.

## Architecture

```
 VigilCalendar ──► VigilSessionOracle ──► VigilRiskEngine ──► VigilOracle (Morpho IOracle) ──► Morpho market (NVDA/USDG)
 (ET clock, DST,    regime, feedIsUsable,   ramped H(L),          price × (1 − min(H, 500 bps))
  on-chain holidays) keeper attest ≤ CLOSED, scheduled events,
                     premium index          π_ref, m(b)

 VigilPremium ──premium──► VigilBackstop (ERC-4626, first-loss) ──cover──► VigilLossReporter.liquidateWithCover
 VigilPreLiquidation: soft unwind for members at H_soft = max(H, cap + 200 bps), time-based Dutch auction
```

| Contract | Responsibility |
|---|---|
| `VigilCalendar` | Deterministic US exchange session calendar from `block.timestamp` (DST 2022–2030 hard-coded, holidays can only be *added*, never removed). |
| `VigilSessionOracle` | Effective regime per asset (calendar + feed freshness + token `oraclePaused`/`effectiveAt` + keeper attestations that may only tighten, ≤ `CLOSED`), `feedIsUsable`, piecewise premium index. |
| `VigilRiskEngine` | Risk surface per asset: `H(L) = clamp(H_floor + k·σ·eventMult·√(L/τ_night))`, ramped purely from time, scheduled events (earnings), `π_ref(L)` and `m(b)` tables. |
| `VigilOracle` | Morpho `IOracle`. Reverts only on `CORP_ACTION` or an *unexpected* stale feed; a feed frozen over the weekend is the normal state. |
| `VigilPremium` | USDG escrow, `due = borrowed × m(b) × Δindex`, membership and delinquency. |
| `VigilBackstop` | ERC-4626 vault over USDG. Exit is request → 7-day cooldown → claim during `MARKET` at the claim-time price. `coverBadDebt` callable only by the loss reporter. |
| `VigilPreLiquidation` | Morpho PreLiquidation pattern (opt-in via `setAuthorization`), session-aware threshold, partial unwind to a target LTV. |
| `VigilLossReporter` | `liquidateWithCover`: the backstop repays a member's shortfall *before* seizure in one transaction — Morpho never realizes bad debt. |

Every contract is immutable: no proxies, no pause switch, each under 13 KB of runtime bytecode.

## Demo: replaying two real Mondays

`script/Demo.s.sol` deploys Morpho Blue from source plus two identical NVDA/USDG markets at 86 % LLTV — a
control market with a plain oracle and a Vigil market — and replays two real Monday-open gaps against a
max-LTV position in each:

| Replay | Control: socialized bad debt | Vigil: bad debt | What Vigil did |
|---|---|---|---|
| 5 Aug 2024 (107.27 → 92.06, −14.18 %) | **40.59 USDG** per 1,072 USDG position | **0** | member unwound Friday 15:00 to 76 % LTV (1.5 % discount), 500 bps market haircut over the weekend, 0.07 USDG premium |
| 27 Jan 2025 (142.62 → 124.80, −12.49 %) | **30.95 USDG** per position | **0** | same |
| Max-LTV member hit by −12 % at Monday 10:00 | — | **0** | 70.12 USDG shortfall covered by the backstop inside the liquidation transaction; suppliers' `totalSupplyAssets` did not fall |

```bash
forge script script/Demo.s.sol -vv
```

The scenario uses the production contracts as-is (no injectable clock) with `vm.warp` to the real dates, so
DST and holidays are exercised for real.

## Getting started

### Prerequisites

- [Foundry](https://getfoundry.sh/) (tested with forge 1.5.x)
- Git (dependencies are git submodules)

### Install, build, test

```bash
git clone --recurse-submodules https://github.com/mdlog/vigil.git
cd vigil
forge build
forge test                                   # 70 tests: unit, historical replay scenarios, invariants
forge coverage --report summary --no-match-coverage "(test|script|mocks)"   # ≈93 % line coverage on src/
```

Dependencies are pinned through `foundry.lock`: `morpho-blue` v1.0.0, `openzeppelin-contracts` v4.9.6,
`forge-std` v1.16.2. The compiler is pinned to 0.8.19 (Morpho Blue's version) with `evm_version = "paris"`
(no `PUSH0`, safe on every Nitro-based L2).

## Deployment

| Network | Chain ID | RPC alias (`foundry.toml`) |
|---|---|---|
| Robinhood Chain testnet | 46630 | `robinhood_testnet` |
| Robinhood Chain mainnet | 4663 | `robinhood_mainnet` |

`script/Deploy.s.sol` deploys one NVDA/USDG market, each contract directly from the EOA. Every dependency is
read from the environment; anything left unset falls back to a mock (testnet 46630 has no Morpho, Chainlink
feeds or stock tokens, verified on-chain on 19 Sep 2026; mainnet 4663 has all of them).

| Variable | Meaning | Mainnet 4663 value | Fallback |
|---|---|---|---|
| `MORPHO` | Morpho Blue | `0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010` | deploy Morpho Blue from source |
| `IRM` | interest rate model | `0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1` (AdaptiveCurveIRM) | `MockIRM` |
| `USDG` | loan token (6 decimals) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | `MockUSDG` |
| `STOCK_TOKEN` | ERC-8056 collateral | NVDA `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | `MockStockToken` |
| `FEED` | Chainlink price feed | NVDA/USD `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15` | `MockFeed` |
| `USDG_FEED` | USDG/USD feed | `0x61B7e5650328764B076A108EFF5fa7282a1B9aD2` | assume $1 |
| `GUARDIAN`, `CALIBRATOR`, `KEEPER_SIGNER` | role holders | — | deployer |
| `LLTV`, `TARGET_LTV`, `CAP_BPS`, `COVERAGE_CAP` | market parameters | — | `0.86e18`, `0.76e18`, `500`, `100000e6` |

```bash
# simulate (no key needed)
forge script script/Deploy.s.sol --rpc-url robinhood_testnet

# broadcast (needs testnet ETH from faucet.testnet.chain.robinhood.com)
forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast --private-key $PRIVATE_KEY
```

## Default parameters

Calibrated from four years of NVDA close-to-open returns (Sep 2022 – Sep 2026); see `script/DeployLib.sol`.

| Parameter | Value | Note |
|---|---|---|
| σ (overnight gap, EWMA) | 1.6 % | earnings nights ≈ 4× wider, handled as scheduled events |
| k (tail multiplier) | 3.0 | empirical 99 % quantile, not the Gaussian 2.33 |
| H_floor / H_max (risk engine) | 50 bps / 2,500 bps | |
| Market haircut cap (oracle) | 500 bps | bounds cascade risk; soft threshold sits 200 bps above |
| Soft-unwind target LTV | 76 % | with 86 % LLTV |
| Backstop cooldown | 7 days | guarantees every exit crosses a weekend |
| Max index segments per `poke` | 128 | ≈ 4 weeks of calendar segments without a keeper |

## Roles and trust assumptions

| Role | Can | Cannot |
|---|---|---|
| `guardian` | add holidays / half days ≥ 7 days ahead, register assets and markets, wire contracts, set coverage cap and poke bounty, transfer its own role | remove a holiday, change haircuts or prices, pause anything, block a liquidation |
| `calibrator` | update the risk surface, premium tables and scheduled events | move parameters outside the on-chain bounds and rate limits |
| `keeperSigner` | sign EIP-712 attestations that *tighten* the regime (halts, emergency closes, unlisted holidays), regime ≤ `CLOSED` | loosen a regime, force `CORP_ACTION`, make the oracle revert |
| `lossReporter` (contract) | draw on the backstop through `coverBadDebt` during a covered liquidation | anything else |

`CORP_ACTION` can only originate from the stock token itself (`oraclePaused()` / `effectiveAt()`). Without any
keeper, the calendar and feed freshness alone produce the full daily cycle; off-chain services (calibrator,
keeper, unwind bot) can only tighten and are not required for safety.

## Design notes

- **Stale feed inside `MARKET`** is measured from `max(updatedAt, lastOpen)` with a per-asset
  `marketStaleSeconds` (6 h): a feed frozen since Friday gets a fresh grace period at Monday 09:30, and a
  quiet stock (AAPL was observed silent for 4.7 h *inside* a session) is not tightened by mistake.
- **Keeper attestations** take effect from their `closeAt`; a halt that brings the close forward must name a
  regime ≥ `EXTENDED`; the ramp starts at `issuedAt`. Found by the invariant fuzzer: without this, a halt
  scheduled 4 seconds ahead became a full step in the haircut.
- **INV-3** (no price steps) is stated for price *decreases*; releasing a haircut when an attestation expires
  may be instantaneous — it does not affect solvency.
- **`liquidateWithCover`** chooses its path from remaining debt vs. `maxRepayable` after cover (not from a
  rounding-sensitive comparison of the covered amount); a 0.001 USDG `DUST` bound guarantees a full seizure
  leaves no bad debt.
- **Time source** is `block.timestamp` only. On Nitro chains `block.number` is an L1 estimate that updates
  periodically and must never be used as a counter.
- The premium index is persisted on every `accrue` (internal `poke`).
- `forge build` reports `unsafe-typecast` lints on casts that are already guarded (`answer > 0`, day index
  < 2³², USDG amounts < 2¹²⁸).

## On-chain verification

Facts checked with `cast`/`curl` against the official Robinhood Chain RPCs on 19 Sep 2026.

<details>
<summary>Verification table</summary>

| # | Item | Result |
|---|---|---|
| V1 | Chain IDs | testnet 46630, mainnet 4663 ✅ |
| V3 | Morpho Blue | mainnet `0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010` (IRM `0x2BD3…0fa1`) ✅; **testnet: absent** → deployed from source |
| V4 | Enabled LLTVs (mainnet) | 62.5 / 77 / 86 / 91.5 / 96.5 % ✅ |
| V5 | USDG | mainnet `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, **6 decimals** → `SCALE_FACTOR = 1e16` ✅ |
| V6 | Stock tokens (registry `api.robinhood.com/rhj/assets`) | NVDA `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC`, AAPL `0xaF3D…93f9`, TSLA `0x322F…3b2d` (mainnet only) |
| V7 | Chainlink feed | NVDA/USD `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15`, 8 decimals, **heartbeat 86,400 s, deviation 0.5 %**, no heartbeat outside market hours |
| V7b | `updatedAt` behaviour | Friday 21:42 ET: NVDA last 15:55, AAPL 11:11, TSLA 15:48 — frozen after close; AAPL silent 4.7 h *inside* the session |
| V8 | Sequencer uptime feed | none among the 57 Robinhood Chain feeds → `SEQ_UPTIME_FEED = 0` |
| V9 | USDG/USD feed | `0x61B7e5650328764B076A108EFF5fa7282a1B9aD2` ✅ → used via `USDG_FEED` |
| V10 | ERC-8056 on the token | `uiMultiplier` = 1.000775 (dividend), `newUIMultiplier`, `effectiveAt`, `oraclePaused` present ✅; `newUIMultiplier() == uiMultiplier()` after `effectiveAt` → post window uses `lastMultiplier` |
| V13 | USDG freeze | `isFrozen(address)` exists |
| V14 | Morpho `repay(onBehalf)` / callbacks | canonical bytecode ✅ |
| V15 | NYSE calendar 2024–2027 | embedded from public schedules; **re-verify at nyse.com before mainnet** |

</details>

## Project structure

```
src/
  VigilCalendar.sol          exchange calendar (ET, DST, holidays)
  VigilSessionOracle.sol     regime, feed freshness, attestations, premium index
  VigilRiskEngine.sol        haircut surface, scheduled events, premium tables
  VigilOracle.sol            Morpho IOracle with ramped haircut
  VigilPremium.sol           USDG premium escrow and membership
  VigilBackstop.sol          ERC-4626 first-loss tranche
  VigilPreLiquidation.sol    session-aware soft unwind
  VigilLossReporter.sol      liquidateWithCover
  interfaces/                IVigil, IAggregatorV3, IStockToken (ERC-8056)
  mocks/                     MockStockToken, MockFeed, MockUSDG, MockIRM, ControlOracle, MockSequencerFeed
script/
  Deploy.s.sol               per-contract deployment from an EOA (env-driven, mocks as fallback)
  Demo.s.sol                 two-market historical replay
  DeployLib.sol              shared calibrated parameters and the demo deployer
test/
  unit/                      one suite per contract
  scenarios/                 historical replays (5 Aug 2024, 27 Jan 2025) and cover paths
  invariants/                fuzzed handler: INV-1, 3, 4, 7, 11, 12
```

## Status and roadmap

- [x] MVP: 8 contracts, 70 tests, historical replay demo, deployment simulated on testnet 46630
- [x] On-chain verification of every mainnet dependency (table above)
- [ ] Broadcast deployment to Robinhood Chain testnet
- [ ] Full calibrator: POT/GPD weekend tail fit, backtest, gap-distribution charts
- [ ] Re-verify the embedded NYSE calendar against nyse.com (V15)
- [ ] Off-chain services: session keeper (attestations) and unwind bot

Out of scope for the MVP: cross-asset portfolio margin, senior/junior tranches, governance, non-ERC-8056
assets, and coverage for borrowers who do not pay the premium (Morpho has no hook to enforce it).

## Contributing

Issues and pull requests are welcome. Please run `forge fmt`, `forge build --sizes` and `forge test` before
opening a PR — CI enforces all three.

## Contributors

- **mdlog** — [adiadi2411@gmail.com](mailto:adiadi2411@gmail.com)

## License

[MIT](LICENSE)
