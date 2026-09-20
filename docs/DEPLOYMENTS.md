# Deployments

Where Vigil runs, how it was deployed and how to deploy it again. Mainnet is covered by [MAINNET.md](MAINNET.md).

## Deploying

| Network | Chain ID | RPC alias (`foundry.toml`) |
|---|---|---|
| Robinhood Chain testnet | 46630 | `robinhood_testnet` |
| Robinhood Chain mainnet | 4663 | `robinhood_mainnet` |

`script/Deploy.s.sol` deploys one stock/USDG market (NVDA by default, TSLA on the live testnet), each contract directly from the EOA. Every dependency is
read from the environment; anything left unset falls back to a mock. Testnet 46630 has Paxos USDG and Robinhood's own
stock tokens (TSLA, AMD, AMZN, NFLX, PLTR) but no Morpho or Chainlink feeds (verified on-chain, 19–20 Sep 2026); mainnet 4663 has all of them.

| Variable | Meaning | Mainnet 4663 value | Fallback |
|---|---|---|---|
| `MORPHO` | Morpho Blue | `0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010` | deploy Morpho Blue from source |
| `IRM` | interest rate model | `0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1` (AdaptiveCurveIRM) | `MockIRM` |
| `USDG` | loan token (6 decimals) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (testnet: Paxos `0x7E955252E15c84f5768B83c41a71F9eba181802F`) | `MockUSDG` |
| `STOCK_TOKEN` | ERC-8056 collateral | NVDA `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` (testnet: Robinhood TSLA `0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E`) | `MockStockToken` |
| `SYMBOL` | ticker of the collateral — picks the calibrated surface (`NVDA`, `TSLA`, `AAPL`) | — | `NVDA` |
| `FEED_INITIAL` | initial answer of the mock feed, 8 decimals | — | `120e8` |
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

**Mainnet.** [`docs/MAINNET.md`](MAINNET.md) is the runbook: go/no-go checklist, `script/MainnetPreflight.s.sol`
(27 read-only checks against the live chain — 26 pass today, the deployer holds no mainnet ETH), a simulated
deployment (24 tx, ≈ 25.3 M gas), a shadow launch with `COVERAGE_CAP=0`, `script/manifest.mjs` and
`script/verify.mjs` to record and source-verify the deployment from the broadcast, `script/Handover.s.sol` to move
every role to a multisig, the keeper in [`ops/`](../ops/README.md), and the incident playbook. Nothing has been sent to
mainnet; [`docs/AUDIT_SCOPE.md`](AUDIT_SCOPE.md) is the review that should come first.

## Live deployment — Robinhood Chain testnet (chain ID 46630)

Deployment **v4**, 2026-09-19 22:52 UTC, from `0x90351bB1E85a17D5f70c62C0cC076D39D897076D` (also `guardian`, `calibrator` and `keeperSigner`), 24 transactions, 26.45 M gas. **Both tokens are real.** Robinhood issues stock tokens on its testnet (TSLA, AMD, AMZN, NFLX, PLTR — BeaconProxies of the verified `Stock` implementation, registered in its `AccessControlsRegistry` and handed out by the testnet faucet) and Paxos issues Global Dollar there, so the market is Robinhood's TSLA against Paxos's USDG with the TSLA calibration (σ 0.0176). What the testnet does not have is Chainlink feeds and Morpho (checked on-chain and in the [Robinhood](https://docs.robinhood.com/chain/protocol-contracts) and [Chainlink](https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood) docs, 19–20 Sep 2026), so the TSLA/USD feed and the IRM are mocks and Morpho Blue v1.0.0 is deployed from source. The testnet `Stock` implementation lacks `oraclePaused()` (the mainnet token has it); `VigilSessionOracle` probes it at registration and skips rule 1 for such tokens — rule 2, the `effectiveAt` window, still applies. Full manifest with transaction hashes: [`deployments/robinhood-testnet-46630.json`](../deployments/robinhood-testnet-46630.json); Foundry broadcast log under `broadcast/Deploy.s.sol/46630/`. Earlier deployments are kept for provenance: [v1](../deployments/robinhood-testnet-46630-v1.json) (before the tightening-ramp fix), [v2](../deployments/robinhood-testnet-46630-v2.json) (all mocks) and [v3](../deployments/robinhood-testnet-46630-v3.json) (mock NVDA, real USDG).

| Contract | Address |
|---|---|
| `VigilCalendar` | [`0x650e89feda871e194a359d8f2b9eda5fa50de503`](https://explorer.testnet.chain.robinhood.com/address/0x650e89feda871e194a359d8f2b9eda5fa50de503) |
| `VigilSessionOracle` | [`0xa1cf321c8b4b49c83cb679d821c8315213b0f0b2`](https://explorer.testnet.chain.robinhood.com/address/0xa1cf321c8b4b49c83cb679d821c8315213b0f0b2) |
| `VigilRiskEngine` | [`0xaec38a26eacfe9f6c908cdd771866c5b56d87c7a`](https://explorer.testnet.chain.robinhood.com/address/0xaec38a26eacfe9f6c908cdd771866c5b56d87c7a) |
| `VigilOracle` | [`0x79da01db22808e3a7397b788f171a7647b1bef8f`](https://explorer.testnet.chain.robinhood.com/address/0x79da01db22808e3a7397b788f171a7647b1bef8f) |
| `VigilPremium` | [`0x416f3716c226c99e5a0296fdda9ba01496348ec9`](https://explorer.testnet.chain.robinhood.com/address/0x416f3716c226c99e5a0296fdda9ba01496348ec9) |
| `VigilBackstop` | [`0x031d0cab44c9a42e2dacf51e0f3b3dcce72356c9`](https://explorer.testnet.chain.robinhood.com/address/0x031d0cab44c9a42e2dacf51e0f3b3dcce72356c9) |
| `VigilPreLiquidation` | [`0xa58609838474a30ea1ebe77d59b6f786abc55978`](https://explorer.testnet.chain.robinhood.com/address/0xa58609838474a30ea1ebe77d59b6f786abc55978) |
| `VigilLossReporter` | [`0xc6e4428fd7cbafbe9f1d2bbca61c44ea984aff16`](https://explorer.testnet.chain.robinhood.com/address/0xc6e4428fd7cbafbe9f1d2bbca61c44ea984aff16) |
| **TSLA — Tesla stock token issued by Robinhood on the testnet** (collateral; ERC-8056 BeaconProxy of the verified `Stock` implementation, registry `0x1dF3…6Ca5`; 5 per claim from [faucet.testnet.chain.robinhood.com](https://faucet.testnet.chain.robinhood.com/)) | [`0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E`](https://explorer.testnet.chain.robinhood.com/address/0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E) |
| **USDG — Global Dollar issued by Paxos on the testnet** (loan token, 6 decimals, EIP-1967 proxy, `isFrozen`; 100 USDG/day from [faucet.paxos.com](https://faucet.paxos.com/)) | [`0x7E955252E15c84f5768B83c41a71F9eba181802F`](https://explorer.testnet.chain.robinhood.com/address/0x7E955252E15c84f5768B83c41a71F9eba181802F) |
| Morpho Blue (deployed from source — testnet has none) | [`0x99607363652591fff66ba23ef8d91563ca48038b`](https://explorer.testnet.chain.robinhood.com/address/0x99607363652591fff66ba23ef8d91563ca48038b) |
| MockFeed TSLA/USD (8 decimals — the testnet has no Chainlink feeds) | [`0x87ae97dd57686e9fbc85ce9d33cc39b6594c49c3`](https://explorer.testnet.chain.robinhood.com/address/0x87ae97dd57686e9fbc85ce9d33cc39b6594c49c3) |
| MockIRM | [`0xc15db6c9c5b7bad92c088e0918d5c720a5c44630`](https://explorer.testnet.chain.robinhood.com/address/0xc15db6c9c5b7bad92c088e0918d5c720a5c44630) |

Morpho market TSLA/USDG, LLTV 86 %: id `0x165f9db8f5e1d9982a35dfaadb3f944cf747970c8f819f16f10105f5c7eb6e04`.

All 11 deployed contracts are source-verified on the explorer (full match, solc 0.8.19, `paris`), so every link above opens readable code; TSLA and USDG are Robinhood's and Paxos's own proxies.

The testnet has no Chainlink feed, so `MockFeed` stands in for TSLA/USD (started at 364.27, TSLA's 18 Sep 2026 close). The real feed has a 24 h heartbeat on trading days; to give the mock the same liveness, the [`feed-heartbeat`](../.github/workflows/feed-heartbeat.yml) workflow re-stamps it (same answer, new `updatedAt`) at 13:00 and 17:00 UTC on weekdays from a throwaway key, `0x85120423aeD49e59F92C9D68aB9102402f37A6FC`, that can do nothing else. Without it `feedIsUsable` would fail closed (`VigilStale`) 18 h after the next session close — the intended behaviour for a dead feed, but not what a visitor should see on a demo.

Quick liveness check (the oracle answers with the session-aware price in USDG per TSLA, 1e36 scale — on a weekend it reads `CLOSED` and applies the 500 bps cap):

```bash
RPC=https://rpc.testnet.chain.robinhood.com
cast call 0x79DA01DB22808E3A7397B788F171a7647b1bEf8f "price()(uint256)" --rpc-url $RPC
cast call 0xa1cF321C8b4B49C83CB679d821C8315213B0f0B2 "regimeOf(address)(uint8,uint8,uint64,uint64)" 0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E --rpc-url $RPC
cd ops && npm ci && npm run keeper -- status         # the same, plus every borrower's state (ops/README.md)
```

## End-to-end run on the live testnet

`script/E2E.s.sol` drives the deployed contracts through a full cycle with five throwaway actors and asserts every step (if any `require` fails in simulation, nothing is broadcast). Nothing is minted: the deployer hands the actors Paxos USDG from the faucet (267 USDG per run) and Robinhood's TSLA tokens (0.15 per borrower) in phase 0. Run on 2026-09-19 against deployment v4 — 37 transactions, blocks 121839842–121840206, gas 5,784,531 (this is the run in the video):

| Phase | What happened | Evidence |
|---|---|---|
| 0 Fund | the deployer sent gas, 267 Paxos USDG and 0.30 Robinhood TSLA to the five actors | [`TSLA transfer`](https://explorer.testnet.chain.robinhood.com/tx/0xf0a0355f304048124521222efbc55b741b5e566c7842913d4f46ad1bbfcb29f0) |
| 1 Supply | Alice supplied 120 USDG | [`supply`](https://explorer.testnet.chain.robinhood.com/tx/0x4bce6a72580f713cae0308b4dc079c7e29c5c8d8b1721689a73f6ecb78f57beb) |
| 2 Borrow | Bob and Erin each posted 0.15 TSLA and borrowed 44.59 USDG at the haircut price (346.05), LTV 85.9 % | [`borrow`](https://explorer.testnet.chain.robinhood.com/tx/0xc21a67c879e9fcbfc7d0978795fc74b00f3dc259c07a05e0b0ae006b2051eb6e) |
| 3 Member | both authorized `VigilPreLiquidation` and funded their premium escrow | [`topUp`](https://explorer.testnet.chain.robinhood.com/tx/0x73f66dcc61de53d811459a5c6e84499c7b4505291fd78b7ec12e07d0ee7680a9) |
| 4 Backstop | Carol deposited 50 USDG and requested a 10 % exit (7-day cooldown) | [`deposit`](https://explorer.testnet.chain.robinhood.com/tx/0x732cd26ae56656de49d129d3e371aae35291eb422918f79e2e03d95a8f5e3706) |
| 5 Keeper | attestation delayed Monday's open by one hour: closure 65.5 h → 66.5 h | [`attest`](https://explorer.testnet.chain.robinhood.com/tx/0xfd3b03f8526e6910fdd0d37433ba67182c07e712c5a95e67580fbffcbba32a79) |
| 6 Unwind | Dave repaid 14.10 USDG for Bob at a 3 % discount → Bob 80 % LTV | [`preLiquidate`](https://explorer.testnet.chain.robinhood.com/tx/0xacfd9d8103c39f2ce453513983f82c4f6b1404eee779632dc813ed99f7e35fdc) |
| 7 Gap | feed −10.81 % (TSLA's 5 Aug 2024 weekend gap, from the calibration): oracle 346.05 → 308.64 | [`set`](https://explorer.testnet.chain.robinhood.com/tx/0xcd94a181c02a08f1f6ed08b94dba9d9482031577278971e2b4d0d49d887a97c8) |
| 8 Cover | Erin's shortfall 0.24 USDG paid by the backstop inside `liquidateWithCover`; Bob needed no cover; suppliers' assets unchanged | [`liquidateWithCover`](https://explorer.testnet.chain.robinhood.com/tx/0x98e9fbf1e2382f6b7f0cca84105d465f5c41eff401f767eb70b1decf3502939a) |
| 9 Restore | feed back to 364.27; backstop 50.00 → 49.76 USDG | [`set`](https://explorer.testnet.chain.robinhood.com/tx/0xc433a0cf03cdd81bb7d29e68c2b70edf72fc040ddbcb756832c34e204bcd4292) |

```bash
forge script script/E2E.s.sol --rpc-url robinhood_testnet --broadcast --slow --gas-estimate-multiplier 200 -vv
```

The same script runs against an Anvil fork of the testnet (`anvil --fork-url robinhood_testnet --chain-id 46630 --block-time 2`) for free. `video/` records a run from the public dashboard and narrates it from the numbers it produced — see [`video/README.md`](../video/README.md). The demo video is the run in the table above, wrapped in static cards (problem, gap distribution, mainnet fork, backtest, links) whose numbers `video/verify.sh` pins to `calibrator/report_full.md` and the README.

## Dashboard

`web/` is a static, read-only page (Vite + TypeScript + viem) that polls the testnet through Multicall3 every 15 s and draws the haircut curve from `VigilRiskEngine.closureHaircutBps` on-chain. It is deployed to GitHub Pages by `.github/workflows/pages.yml`.

```bash
cd web && npm install
npm run dev            # http://127.0.0.1:5173/vigil/
npm test               # pure-function tests
npm run test:network   # parity of the on-chain haircut curve with test/unit/CurveFixture.t.sol
npm run abi            # regenerate src/abi from ../out after `forge build`
```
