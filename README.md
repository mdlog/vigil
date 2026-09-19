# Vigil

[![CI](https://github.com/mdlog/vigil/actions/workflows/test.yml/badge.svg)](https://github.com/mdlog/vigil/actions/workflows/test.yml)
[![Solidity 0.8.19](https://img.shields.io/badge/solidity-0.8.19-363636?logo=solidity)](foundry.toml)
[![Built with Foundry](https://img.shields.io/badge/built%20with-Foundry-FFDB1C)](https://getfoundry.sh/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Session-aware collateral risk layer for tokenized equity on Morpho Blue — built for Robinhood Chain.**

**Live dashboard:** https://mdlog.github.io/vigil/ — the current session regime, oracle price vs. feed, haircut curve, premium index and backstop, read straight from the testnet.

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
- [Live deployment — Robinhood Chain testnet](#live-deployment--robinhood-chain-testnet-chain-id-46630)
- [End-to-end run on the live testnet](#end-to-end-run-on-the-live-testnet)
- [Mainnet fork: the real dependencies, no mocks](#mainnet-fork-the-real-dependencies-no-mocks)
- [Dashboard](#dashboard)
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

Every contract is immutable: no proxies, no pause switch, the largest 13.1 KB of runtime bytecode (limit 24 KB).

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

## Dashboard

`web/` is a static, read-only page (Vite + TypeScript + viem) that polls the testnet through Multicall3 every 15 s and draws the haircut curve from `VigilRiskEngine.closureHaircutBps` on-chain. It is deployed to GitHub Pages by `.github/workflows/pages.yml`.

```bash
cd web && npm install
npm run dev            # http://127.0.0.1:5173/vigil/
npm test               # pure-function tests
npm run test:network   # parity of the on-chain haircut curve with test/unit/CurveFixture.t.sol
npm run abi            # regenerate src/abi from ../out after `forge build`
```

## Getting started

### Prerequisites

- [Foundry](https://getfoundry.sh/) (tested with forge 1.5.x)
- Git (dependencies are git submodules)

### Install, build, test

```bash
git clone --recurse-submodules https://github.com/mdlog/vigil.git
cd vigil
forge build
forge test                                   # 77 tests: unit, historical replay scenarios, invariants, fuzz regressions
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
| `PRIVATE_KEY` | deployer key for `--broadcast` | — | wallet flags (`--private-key`, `--account`) |
| `GUARDIAN`, `CALIBRATOR`, `KEEPER_SIGNER` | role holders | — | deployer |
| `LLTV`, `TARGET_LTV`, `CAP_BPS`, `COVERAGE_CAP` | market parameters | — | `0.86e18`, `0.76e18`, `500`, `100000e6` |

```bash
cp .env.example .env            # then set PRIVATE_KEY (gitignored; forge loads .env automatically)

# simulate (no key needed)
forge script script/Deploy.s.sol --rpc-url robinhood_testnet

# broadcast (the deployer needs testnet ETH from faucet.testnet.chain.robinhood.com)
forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast
```

`PRIVATE_KEY` may be left empty in favour of `--private-key`, `--account` or `--sender`.

### Live deployment — Robinhood Chain testnet (chain ID 46630)

Deployed 2026-09-19 from `0x90351bB1E85a17D5f70c62C0cC076D39D897076D` (also `guardian`, `calibrator` and `keeperSigner`), 26 transactions, 28.14 M gas. Full manifest with transaction hashes: [`deployments/robinhood-testnet-46630.json`](deployments/robinhood-testnet-46630.json); Foundry broadcast log under `broadcast/Deploy.s.sol/46630/`. The first deployment of the day (before the tightening-ramp fix, see Design notes) is kept as [`deployments/robinhood-testnet-46630-v1.json`](deployments/robinhood-testnet-46630-v1.json) because the recorded end-to-end run below was filmed against it.

| Contract | Address |
|---|---|
| `VigilCalendar` | [`0x3Ffe81615B8B1909f684e9a7c1Eb82a38c0A0b8C`](https://explorer.testnet.chain.robinhood.com/address/0x3Ffe81615B8B1909f684e9a7c1Eb82a38c0A0b8C) |
| `VigilSessionOracle` | [`0x575a54Bc6D25e19b60Fc67B5cCea09Bfee12a0fD`](https://explorer.testnet.chain.robinhood.com/address/0x575a54Bc6D25e19b60Fc67B5cCea09Bfee12a0fD) |
| `VigilRiskEngine` | [`0xb92B73E35C740F2893c949110A742E31554fc2aE`](https://explorer.testnet.chain.robinhood.com/address/0xb92B73E35C740F2893c949110A742E31554fc2aE) |
| `VigilOracle` | [`0x445A820a0F3AeE54E43715620938e71b04a2974e`](https://explorer.testnet.chain.robinhood.com/address/0x445A820a0F3AeE54E43715620938e71b04a2974e) |
| `VigilPremium` | [`0xFb3E7B6b169FDF655d76D6984A895bFA4703Bb70`](https://explorer.testnet.chain.robinhood.com/address/0xFb3E7B6b169FDF655d76D6984A895bFA4703Bb70) |
| `VigilBackstop` | [`0x27873298da0D56c3EFB17bdF7a39e1C4808149b9`](https://explorer.testnet.chain.robinhood.com/address/0x27873298da0D56c3EFB17bdF7a39e1C4808149b9) |
| `VigilPreLiquidation` | [`0x824a6d52Ad196796BfeA76b8754fddC111F70b07`](https://explorer.testnet.chain.robinhood.com/address/0x824a6d52Ad196796BfeA76b8754fddC111F70b07) |
| `VigilLossReporter` | [`0x740c6CA8C04C5f528Db86f1779A467bf91424984`](https://explorer.testnet.chain.robinhood.com/address/0x740c6CA8C04C5f528Db86f1779A467bf91424984) |
| Morpho Blue (deployed from source — testnet has none) | [`0x62ded950D641CbDC935eB6F28Be19912c84afAd9`](https://explorer.testnet.chain.robinhood.com/address/0x62ded950D641CbDC935eB6F28Be19912c84afAd9) |
| MockUSDG (loan token, 6 decimals) | [`0xf6349DfD96DAbdf6ed596f25e272060E5E6860EF`](https://explorer.testnet.chain.robinhood.com/address/0xf6349DfD96DAbdf6ed596f25e272060E5E6860EF) |
| MockStockToken NVDA (ERC-8056 mock, collateral) | [`0x78E2A9b5a2e725B4fCFeA23Cb4f9Aa8232491f90`](https://explorer.testnet.chain.robinhood.com/address/0x78E2A9b5a2e725B4fCFeA23Cb4f9Aa8232491f90) |
| MockFeed NVDA/USD (8 decimals) | [`0xa21b9aaa5E7074E7171Cb8B3b166BcFAba36e9C3`](https://explorer.testnet.chain.robinhood.com/address/0xa21b9aaa5E7074E7171Cb8B3b166BcFAba36e9C3) |
| MockIRM | [`0xa41Bfe7f75719bA17aE7046929dF7a89E580Dbc3`](https://explorer.testnet.chain.robinhood.com/address/0xa41Bfe7f75719bA17aE7046929dF7a89E580Dbc3) |

Morpho market NVDA/USDG, LLTV 86 %: id `0x4b7339b6469bf06ff83ec7ec4baa995f2589ae7782d11b2ba6d02c2c218a5145`.

Quick liveness check (the oracle answers with the session-aware price — on a weekend it reads `CLOSED` and applies the 500 bps cap):

```bash
RPC=https://rpc.testnet.chain.robinhood.com
cast call 0x445A820a0F3AeE54E43715620938e71b04a2974e "price()(uint256)" --rpc-url $RPC
cast call 0x575a54Bc6D25e19b60Fc67B5cCea09Bfee12a0fD "regimeOf(address)(uint8,uint8,uint64,uint64)" 0x78E2A9b5a2e725B4fCFeA23Cb4f9Aa8232491f90 --rpc-url $RPC
```

### End-to-end run on the live testnet

`script/E2E.s.sol` drives the deployed contracts through a full cycle with five throwaway actors and asserts every step (if any `require` fails in simulation, nothing is broadcast). Run on 2026-09-19 against the deployment above — 37 transactions, blocks 121593273–121593758, gas 5,227,492:

| Phase | What happened | Evidence |
|---|---|---|
| 1 Supply | Alice supplied 10,000 mock USDG | [`supply`](https://explorer.testnet.chain.robinhood.com/tx/0x8220cc9f51f8563bc4bdc00f4d622c5470a8cc0665751246e1844a4338a9f972) |
| 2 Borrow | Bob and Erin each posted 10 NVDA and borrowed 979.26 USDG at the haircut price (114.00), LTV 85.9 % | [`borrow`](https://explorer.testnet.chain.robinhood.com/tx/0x67ccfc4f1d49d26536cdce226b3602ca1c9f63e0bc8f3765a250b2f06d3d9900) |
| 3 Member | both authorized `VigilPreLiquidation` and funded their premium escrow | [`topUp`](https://explorer.testnet.chain.robinhood.com/tx/0x454d166ce6dca1aa6523ff816a3fa1760fa2b4da58293fd068a0eb7cfa786b86) |
| 4 Backstop | Carol deposited 5,000 USDG and requested a 10 % exit (7-day cooldown) | [`deposit`](https://explorer.testnet.chain.robinhood.com/tx/0x8bcb35f3c7b7e574dc1983e3d3694fadd2730090eac9c6f55bc822963829e05e) |
| 5 Keeper | attestation delayed Monday's open by one hour: closure 65.5 h → 66.5 h | [`attest`](https://explorer.testnet.chain.robinhood.com/tx/0xd190a9c22a1f45d36f3b9053b115bdb83fc4d2b64c32d181f4ae6ac55be3ead9) |
| 6 Unwind | Dave repaid 309.67 USDG for Bob at a 3 % discount → Bob 80 % LTV | [`preLiquidate`](https://explorer.testnet.chain.robinhood.com/tx/0x99e5df2e07d491745b0e14041bb58f9f7998baa5e475073640df2f70316d0264) |
| 7 Gap | feed −14.18 % (5 Aug 2024 replay): oracle 114.00 → 97.83 | [`set`](https://explorer.testnet.chain.robinhood.com/tx/0x59230b07b89d2d61eb082388da4a5e65372bef4a8381b84382fd3ed97dc706df) |
| 8 Cover | Erin's shortfall 42.00 USDG paid by the backstop inside `liquidateWithCover`; Bob needed no cover; suppliers' assets unchanged | [`liquidateWithCover`](https://explorer.testnet.chain.robinhood.com/tx/0x72628247d2073d04abac25145fe08b016eaf4d205319e93f099690ad9454f809) |
| 9 Restore | feed back to 120.00; backstop 5,000 → 4,957.95 USDG | [`set`](https://explorer.testnet.chain.robinhood.com/tx/0x9e5e40752ab17f9801ea374acff99e607c4e3f08f3ec2eb760019f33b54da912) |

```bash
forge script script/E2E.s.sol --rpc-url robinhood_testnet --broadcast --slow --gas-estimate-multiplier 200 -vv
```

The same script runs against an Anvil fork of the testnet (`anvil --fork-url robinhood_testnet --chain-id 46630 --block-time 2`) for free. `video/` records a run from the public dashboard and narrates it from the numbers it produced — see [`video/README.md`](video/README.md); the recorded take was filmed against deployment v1 (same script, same numbers).

### Mainnet fork: the real dependencies, no mocks

`test/fork/MainnetFork.t.sol` forks Robinhood Chain **mainnet** (4663) at the latest block and runs Vigil against the real Morpho Blue, AdaptiveCurveIRM, USDG (Paxos proxy), the NVDA stock token (ERC-8056 beacon proxy — real `uiMultiplier` 1.000775, `effectiveAt`, `oraclePaused`) and the Chainlink NVDA/USD and USDG/USD feeds. Balances are created with `deal` on the local copy; nothing is broadcast and nothing costs gas.

```bash
FOUNDRY_PROFILE=fork FOUNDRY_FORK_TESTS=1 forge test --match-path test/fork/MainnetFork.t.sol -vv
```

| Test | What it proves on real state (2026-09-19, a Saturday) |
|---|---|
| `frozenRealFeedIsUsableAndHaircutApplies` | the Chainlink feed last updated Friday 15:55 ET (222.45 USD) is *usable*, and `price()` = feed ÷ USDG/USD × (1 − 5 %) |
| `realStockTokenFlagsDriveCorpAction` | the real token's dividend multiplier and past `effectiveAt` do not trigger `CORP_ACTION`; only `oraclePaused()` (injected) makes the oracle revert |
| `weekendGapCycleOnRealMorpho` | supply → borrow (1,815 USDG per 10 NVDA at the haircut price) → membership → backstop → Bob unwound to 80 % LTV → Monday 09:30 ET with the feed still frozen (6-hour grace) and the weekend haircut ramping out (500 bps at +10 min, 244 bps at +45 min) → −14.18 % gap injected → Erin's 31.20 USDG shortfall paid by the backstop, Bob needs no cover, suppliers untouched — on the real Morpho with the real IRM |

Two injections only, both named in the test: the gap price (the real feed cannot be moved) and a fresh `updatedAt` for the USDG/USD feed after `vm.warp` (on the real chain it keeps updating). The public RPC is not an archive node (state for roughly the last 1,000 blocks), so the fork pins the latest block and Foundry's cache carries later runs; `FORK_BLOCK=<n>` pins a block explicitly. The tests skip without `FOUNDRY_FORK_TESTS=1`, so CI stays offline. The `fork` profile sets `evm_version = "cancun"` because mainnet contracts use `PUSH0`.

The mainnet deployment path simulates end to end against the same real dependencies (no key needed):

```bash
MORPHO=0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010 IRM=0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1 \
USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 STOCK_TOKEN=0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC \
FEED=0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 USDG_FEED=0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 \
FOUNDRY_PROFILE=fork forge script script/Deploy.s.sol --rpc-url robinhood_mainnet
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
- **A tightening is a ramped increment on top of the calendar haircut**, never a restart from zero:
  `h = h_cal + (H_tight − h_cal) · f`, with `f` ramping from the moment the tightening was issued. Consecutive
  keeper attestations carry the same start, so a keeper refreshing every 30 minutes keeps the ramp going.
  (Found by the invariant fuzzer: a `CLOSED` attestation in the middle of `EXTENDED` used to zero the haircut,
  lift the price, and then drop it 500 bps when the calendar caught up.)
- **`liquidateWithCover`** chooses its path from remaining debt vs. `maxRepayable` after cover (not from a
  rounding-sensitive comparison of the covered amount); a 0.001 USDG `DUST` bound guarantees a full seizure
  leaves no bad debt.
- **Time source** is `block.timestamp` only. On Nitro chains `block.number` is an L1 estimate that updates
  periodically and must never be used as a counter.
- **Premium index accrual is a function of time, not of `block.timestamp`.** Keeper attestations are
  accrued over their stored window `[issuedAt, issuedAt + 30 min)` even after they stop being fresh, so the
  index is exact and poke-independent for calendar regimes and attestations alike. Tightenings derived from
  external state (a stale feed inside `MARKET`, a corporate-action window) cannot be reconstructed after the
  fact, so they are persisted only when a `poke` observes them and never enter the `premiumIndex` view — the
  view is a monotone lower bound, and membership checks that read it cannot flip on their own. (Found by the
  invariant fuzzer: an attestation expiring without a poke used to make the view *decrease*.)
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
  E2E.s.sol                  end-to-end cycle against a live deployment (testnet or Anvil fork)
  DeployLib.sol              shared calibrated parameters and the demo deployer
web/
  src/                       static dashboard (see Dashboard); src/abi is generated from out/
video/                       records an E2E run from the dashboard and narrates it (video/README.md)
test/
  fork/                      mainnet-fork suite against the real Morpho, USDG, NVDA token and Chainlink feeds
  unit/                      one suite per contract
  scenarios/                 historical replays (5 Aug 2024, 27 Jan 2025) and cover paths
  invariants/                fuzzed handler: INV-1, 3, 4, 7, 11, 12
```

## Status and roadmap

- [x] MVP: 8 contracts, 77 tests, historical replay demo
- [x] On-chain verification of every mainnet dependency (table above)
- [x] Live on Robinhood Chain testnet 46630 (addresses above)
- [x] Live dashboard on GitHub Pages
- [x] End-to-end run on the live testnet (37 transactions, recorded)
- [x] Mainnet-fork suite against the real dependencies; mainnet deployment simulated
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
