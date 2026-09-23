# Evidence and verification

What has been shown to work, and against what: a historical replay with the production contracts, the mainnet
fork against the real dependencies, and the on-chain facts every parameter rests on. The live testnet run is in
[DEPLOYMENTS.md](DEPLOYMENTS.md#end-to-end-run-on-the-live-testnet).

## Historical replay: two real Mondays

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

## Mainnet fork: the real dependencies, no mocks

`test/fork/MainnetFork.t.sol` forks Robinhood Chain **mainnet** (4663) at the latest block and runs Vigil against the real Morpho Blue, AdaptiveCurveIRM, USDG (Paxos proxy), the NVDA stock token (ERC-8056 beacon proxy — real `uiMultiplier` 1.000775 and `effectiveAt`, plus Robinhood's `oraclePaused`) and the Chainlink NVDA/USD and USDG/USD feeds. Balances are created with `deal` on the local copy; nothing is broadcast and nothing costs gas.

```bash
FOUNDRY_PROFILE=fork FOUNDRY_FORK_TESTS=1 forge test --match-path test/fork/MainnetFork.t.sol -vv
```

| Test | What it proves on real state (2026-09-19, a Saturday) |
|---|---|
| `frozenRealFeedIsUsableAndHaircutApplies` | the Chainlink feed last updated Friday 15:55 ET (222.45 USD) is *usable*, and `price()` = feed ÷ USDG/USD × (1 − 5 %) |
| `realStockTokenFlagsDriveCorpAction` | the real token's dividend multiplier and past `effectiveAt` do not trigger `CORP_ACTION`; only `oraclePaused()` (injected) makes the oracle revert |
| `weekendGapCycleOnRealMorpho` | supply → borrow (1,815 USDG per 10 NVDA at the haircut price) → membership → backstop → Bob unwound to 80 % LTV → Monday 09:30 ET with the feed held at Friday's value (6-hour grace; on mainnet the feed resumes earlier, at the Sunday 20:00 ET overnight open) and the weekend haircut ramping out (500 bps at +10 min, 244 bps at +45 min) → −14.18 % gap injected → Erin's 31.20 USDG shortfall paid by the backstop, Bob needs no cover, suppliers untouched — on the real Morpho with the real IRM |

Two injections only, both named in the test: the gap price (the real feed cannot be moved) and a fresh `updatedAt` for the USDG/USD feed after `vm.warp` (on the real chain it keeps updating). The public RPC is not an archive node (state for roughly the last 1,000 blocks), so the fork pins the latest block and Foundry's cache carries later runs; `FORK_BLOCK=<n>` pins a block explicitly. The tests skip without `FOUNDRY_FORK_TESTS=1`, so CI stays offline. The `fork` profile sets `evm_version = "cancun"` because mainnet contracts use `PUSH0`.

The mainnet deployment path simulates end to end against the same real dependencies (no key needed):

```bash
MORPHO=0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010 IRM=0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1 \
USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 STOCK_TOKEN=0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC \
FEED=0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 USDG_FEED=0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 \
FOUNDRY_PROFILE=fork forge script script/Deploy.s.sol --rpc-url robinhood_mainnet
```

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
| V7b | `updatedAt` behaviour | Friday 21:42 ET: NVDA last 15:55, AAPL 11:11, TSLA 15:48 — frozen after close; AAPL silent 4.7 h *inside* the session. Weekend of 18–21 Sep (round history): silent until the overnight session opens at Sunday 20:00 ET — NVDA 52.1 h, TSLA 52.2 h, SPCX 48.9 h — then sparse overnight prints (NVDA Sunday 21:17, Monday 05:42) before the 09:30 open |
| V8 | Sequencer uptime feed | none among the 57 Robinhood Chain feeds → `SEQ_UPTIME_FEED = 0` |
| V9 | USDG/USD feed | `0x61B7e5650328764B076A108EFF5fa7282a1B9aD2` ✅ → used via `USDG_FEED` |
| V10 | ERC-8056 on the token, plus Robinhood's extension | `uiMultiplier` = 1.000775 (dividend), `newUIMultiplier`, `effectiveAt` (ERC-8056) and `oraclePaused` (Robinhood's OraclePausable, not part of ERC-8056) present ✅; `newUIMultiplier() == uiMultiplier()` after `effectiveAt` → post window uses `lastMultiplier` |
| V13 | USDG freeze | `isFrozen(address)` exists |
| V14 | Morpho `repay(onBehalf)` / callbacks | canonical bytecode ✅ |
| V15 | NYSE calendar 2024–2028 | ✅ verified 19 Sep 2026: all 50 closures + 11 early closes match nyse.com/markets/hours-calendars (2026–2028 on the current page; 2024–2025 via Wayback snapshots of 29 May 2024 and 5 Mar 2025; the ad-hoc 9 Jan 2025 closure via the ICE/NYSE release), DST 2022–2030 matches `zoneinfo`; pinned by `test_calendar_matchesOfficialNyse2024to2028`. The live v2 calendar carries 2024–2027; 2028 is embedded for the next deployment and can be added to v2 by the guardian (add-only) |
| V16 | Paxos USDG on the testnet | ✅ `0x7E955252E15c84f5768B83c41a71F9eba181802F` — `Global Dollar`, 6 decimals, EIP-1967 proxy, `isFrozen`; 100/day from faucet.paxos.com ("Robinhood Chain Testnet" is a listed network); 2,909 holders |
| V17 | Robinhood stock tokens on the testnet | ✅ TSLA `0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E`, AMD `0x7117…778d`, AMZN `0x5884…9E02`, NFLX `0x3b82…8C93`, PLTR `0x1FBE…98d0` — BeaconProxies (569 bytes, like mainnet NVDA) of the verified `Stock` implementation, registered in `AccessControlsRegistry` `0x1dF3…6Ca5`, 220–287 k holders each, 5 per faucet claim; `uiMultiplier`/`newUIMultiplier`/`effectiveAt` present, **`oraclePaused()` absent** (mainnet has it) → probed at `registerAsset`. An official NVDA (`0x9970…a737`) exists with zero supply |

</details>
