# Mainnet runbook — Vigil on Robinhood Chain (chain ID 4663)

This is the operating procedure for taking the contracts that run on the testnet to mainnet, written before
any mainnet transaction was sent. It is deliberately conservative: a **shadow launch** first (everything
deployed and watched for a week with the backstop covering nothing), a **handover** of every privileged role
to contract holders, then a **guarded launch** where the coverage cap is raised in steps. Every command below
has been run against a mainnet fork or the mainnet RPC in read-only mode; what has *not* been done is listed
at the end.

Nothing in Vigil is upgradeable or pausable. The contracts you deploy are the contracts you live with, so the
order of the steps matters more than their speed.

## 0. Go / no-go

| # | Condition | How to check | Status (20 Sep 2026) |
|---|---|---|---|
| G1 | `forge test` green, including the mainnet-fork suite | `forge test` (80) and `FOUNDRY_PROFILE=fork FOUNDRY_FORK_TESTS=1 forge test --match-path test/fork/MainnetFork.t.sol` (3) | ✅ |
| G2 | Pre-flight passes against the live chain | `FOUNDRY_PROFILE=fork forge script script/MainnetPreflight.s.sol --rpc-url robinhood_mainnet -vv` → `PREFLIGHT PASS` | 26/27, only the deployer's ETH fails |
| G3 | Deployer funded | ≥ 0.005 ETH on 4663 (the deployment is 24 tx ≈ 25.3 M gas ≈ 0.0033 ETH at 0.13 gwei); 0.01 ETH leaves room for the post-deploy calls | ❌ 0 ETH |
| G4 | Role holders decided | `GUARDIAN` and `CALIBRATOR` are contracts (a Safe with a timelock) — or `ALLOW_EOA=true` is a conscious decision for the shadow period only; `KEEPER_SIGNER` is a hot key that holds gas only. Safe 1.4.1 and 1.3.0 singletons and proxy factories exist on 4663 at their canonical addresses (`0x29fc…C762`, `0x4e1D…ec67`, `0xd9Db…9552`, `0xa6B7…6AB2`; checked 20 Sep 2026), so a Safe can be created with `safe-cli` or `cast` even if the hosted web app does not list the chain | Safe available; addresses not chosen |
| G5 | Someone can hold the stock token | Robinhood's mainnet stock tokens are transfer-restricted through their `AccessControlsRegistry`; the team must confirm an eligible wallet can hold NVDA to exercise the borrow path with real funds (the fork suite proves the path with a whale's tokens) | open |
| G6 | Audit | `docs/AUDIT_SCOPE.md` — no external audit has been performed | ❌ |
| G7 | Operator on call | a machine running `ops/keeper.ts` (`poke`, `unwind`, `liquidate` loops) and the `keeper-status` workflow pointed at the mainnet manifest | ready, not running |

Do not raise `COVERAGE_CAP` above 0 before G4, G6 and G7 are green.

## 1. Environment

```bash
cp .env.mainnet.example .env.mainnet          # addresses verified on-chain 19–20 Sep 2026 (docs/VERIFICATION.md)
# fill PRIVATE_KEY — or leave it empty and use `--account <keystore>` from `cast wallet import` on every forge command
set -a; . ./.env.mainnet; set +a
```

`FOUNDRY_PROFILE=fork` is required on every script that touches the live contracts: Morpho, USDG and the
stock token are compiled for Cancun (`PUSH0`), and the simulation's EVM must accept it. Our bytecode does not
change under that profile — solc 0.8.19 caps the EVM version at `paris`, checked by comparing the artifacts.

The deployer key never lives on the keeper host; the keeper's `OPS_PRIVATE_KEY` is a different key.

## 2. Pre-flight (read-only)

```bash
FOUNDRY_PROFILE=fork forge script script/MainnetPreflight.s.sol --rpc-url robinhood_mainnet -vv
```

27 checks: chain id, Morpho code and enabled IRM / LLTV, USDG decimals and `isFrozen(deployer)`, the stock
token's symbol / decimals / ERC-8056 surface / `oraclePaused` / registry (`paused`, `isBlocked(deployer)`,
`isBlocked(Morpho)`), both feeds (decimals, freshness under Vigil's own rules, USDG/USD within 2 % of $1 and
younger than 2 days), a calibrated surface for `SYMBOL`, `CAP_BPS` within bounds, the embedded NYSE calendar
reaching ≥ 90 days ahead, and the deployer's ETH. It reverts with `PREFLIGHT FAIL` on any failure, so it can
gate a pipeline. Run it on the day of the deployment, not the week before: the feed checks are about *now*.

## 3. Simulate

```bash
FOUNDRY_PROFILE=fork forge script script/Deploy.s.sol --rpc-url robinhood_mainnet
```

Expected: 24 transactions, ≈ 25.3 M gas, and a sanity block at the end — the regime the calendar reads right
now and `VigilOracle.price()` (Morpho's scale: USDG per NVDA × 1e24, i.e. 1e36 × 10⁶ / 10¹⁸). On 20 Sep 2026 the simulation
priced NVDA at 211.34 USDG with the weekend haircut applied. If `price()` reverts in the simulation, stop:
the feed is stale under Vigil's rules and the market would open fail-closed.

## 4. Deploy (shadow: `COVERAGE_CAP=0`, roles = deployer)

```bash
FOUNDRY_PROFILE=fork forge script script/Deploy.s.sol --rpc-url robinhood_mainnet --broadcast --slow
```

`--slow` sends the 24 transactions one at a time and waits for each receipt; on a public RPC that is the
difference between a clean broadcast and a half-deployed system. If the broadcast stops midway, **do not
re-run it** — `forge script --resume` continues from the broadcast record. `.env.mainnet.example` leaves
`GUARDIAN`/`CALIBRATOR`/`KEEPER_SIGNER` empty on purpose: the deployer keeps every role until the shadow
period is over, then hands them over (step 8). Nothing can be lost in the meantime because the backstop's cap
is 0 and nobody has been told to deposit.

## 5. Record and verify

```bash
node script/manifest.mjs --chain 4663 --env .env.mainnet --out deployments/robinhood-mainnet-4663.json
node script/verify.mjs --chain 4663           # Blockscout, every CREATE in the broadcast, constructor args from the record
git add deployments/robinhood-mainnet-4663.json broadcast/Deploy.s.sol/4663 && git commit -m "Deploy v1 on Robinhood Chain mainnet"
```

The manifest generator reads only the six dependency addresses and `SYMBOL` from the env file — never the key —
and takes the market id from Morpho's `CreateMarket` log; on the testnet broadcast it reproduces the committed
manifest to the byte. The verifier was checked against the testnet deployment (Blockscout reports the
contracts already verified).

## 6. Post-deploy checks

```bash
cd ops && npm ci && npm run keeper -- status --strict --manifest deployments/robinhood-mainnet-4663.json
```

`status` must show the same regime as the calendar, `feed usable`, a price, `index lag 0 h` and no alert.
Then the checks the pre-flight could not do because the addresses did not exist yet — the registry must not
block the contracts that hold the stock token during a liquidation:

```bash
M=deployments/robinhood-mainnet-4663.json; RPC=https://rpc.mainnet.chain.robinhood.com
REG=$(cast call --rpc-url $RPC $(jq -r .contracts.StockToken.address $M) 'ACCESS_CONTROLLED_REGISTRY()(address)')
for n in Morpho VigilPreLiquidation VigilLossReporter; do
  echo "$n blocked: $(cast call --rpc-url $RPC $REG 'isBlocked(address)(bool)' $(jq -r .contracts.$n.address $M))"
done
```

Dashboard against the new manifest, locally and on Pages:

```bash
VIGIL_MANIFEST=deployments/robinhood-mainnet-4663.json npm --prefix web run build   # or run the Pages workflow with that input
```

## 7. Shadow period (≥ 7 days, must include a weekend)

The market exists, the cap is 0, nothing is announced. What runs:

- `keeper-status` workflow with `MANIFEST` switched to the mainnet file (four times a day, fails on any alert).
- On the keeper host: `npm run keeper -- poke --loop 3600 --send` so the premium index is persisted hourly. The
  bounty is optional during the shadow period; before launch the guardian funds it (`fundBounty(asset, amount)`
  with USDG, `setPokeBounty(amount)`) so third parties are paid to do the same.
- Watch, on the dashboard or with `status`: the 09:30 / 16:00 / 20:00 ET transitions on a trading day, the
  haircut ramp after Friday's close, `feedIsUsable` staying true through the weekend (the NVDA/USD feed freezes
  at Friday 15:55 ET and Vigil accepts that: `updatedAt + 18 h ≥ closeAt`), the Monday 09:30 release, and — if
  one falls in the window — the ERC-8056 corporate-action window (`effectiveAt`) producing `CORP_ACTION`.
- Exercise with the team's own funds, small: supply 100 USDG, deposit 100 USDG into the backstop, request a
  withdrawal and claim it after the 7-day cooldown during `MARKET` (this alone takes the whole shadow week).
  The borrow / unwind / cover path needs NVDA in an eligible wallet (G5); until then it is proven on the fork:
  `anvil --fork-url https://rpc.mainnet.chain.robinhood.com` and the keeper against it, as was done for the
  testnet deployment.

Anything unexpected here is the cheapest bug you will ever find. The remedy is a redeploy (step 4 again,
version 2 in the manifest) — the shadow contracts are simply abandoned with their cap at 0.

## 8. Handover

```bash
MANIFEST=deployments/robinhood-mainnet-4663.json GUARDIAN=0x… CALIBRATOR=0x… KEEPER_SIGNER=0x… \
  FOUNDRY_PROFILE=fork forge script script/Handover.s.sol --rpc-url robinhood_mainnet           # prints the plan
  … --broadcast                                                                                # 7 calls
for c in VigilCalendar VigilSessionOracle VigilBackstop VigilPremium VigilPreLiquidation VigilLossReporter; do
  cast call --rpc-url $RPC $(jq -r .contracts.$c.address $M) 'guardian()(address)'; done
cast call --rpc-url $RPC $(jq -r .contracts.VigilRiskEngine.address $M) 'calibrator()(address)'
cast call --rpc-url $RPC $(jq -r .contracts.VigilSessionOracle.address $M) 'keeperSigner()(address)'
```

The script refuses an EOA guardian or calibrator unless `ALLOW_EOA=true`. After the handover the deployer key
can do nothing; retire it.

## 9. Guarded launch

From the guardian (a Safe transaction each):

1. `VigilBackstop.setCoverageCap(marketId, cap)` — start small (10,000 USDG) and only up to what the backstop
   actually holds; the cap is the most the backstop will ever pay for this market, so it is the number to
   announce.
2. Seed the backstop from the team's own USDG (`deposit`) before anyone else does: the first-loss tranche
   should carry the team's money first.
3. `VigilSessionOracle.setPokeBounty(amount)` and `fundBounty(asset, amount)`.
4. Announce, with the dashboard link and the explorer links from the manifest.
5. Raise the cap in steps as deposits grow. The keeper flags `cap 80 % used`.

Morpho Blue has no supply cap; the exposure Vigil takes is bounded by the coverage cap, not by the market.

## 10. Operating the market

| Job | Who | Command | Cadence |
|---|---|---|---|
| Health watch | CI | `keeper-status` workflow (`status --strict`) | 4 × / day |
| Premium index | anyone (bounty) | `poke --loop 3600 --send` | hourly |
| Soft unwind | keeper with USDG float | `unwind --loop 300 --send` | 5 min, matters Friday 15:00–16:00 ET and during `EXTENDED` |
| Covered liquidation | keeper with USDG float | `liquidate --loop 60 --send` | 1 min, matters Monday 09:30 ET |
| Halts, unlisted closures | `keeperSigner` | `attest --regime CLOSED --close-at now --next-open +1h --send` | on NYSE halts (LULD pauses and market-wide circuit breakers), ad-hoc closures the calendar does not know (a national day of mourning, as on 9 Jan 2025) |
| Known future closures | guardian | `VigilCalendar.addHoliday` / `addHalfDay`, ≥ 7 days ahead | when NYSE publishes them; the embedded calendar runs to end-2028 |
| Surface / tables | calibrator | `VigilRiskEngine.setSurface` / `setPremiumTables` / `scheduleEvent` | quarterly re-calibration (`calibrator/`), before earnings nights |

Attestations last 30 minutes; a halt longer than that needs a fresh one every half hour (the ramp continues,
it does not restart). An attestation can only tighten, so a compromised keeper key can make the market more
conservative, never less; rotate it with `VigilSessionOracle.setRoles`.

## 11. Incident playbook

What no role can do: pause, upgrade, change a price, remove a holiday, block a liquidation, take user funds.
What the roles can do, in order of severity:

1. **Stop covering** — guardian `setCoverageCap(id, 0)`. New liquidations run as plain Morpho liquidations;
   existing backstop deposits are untouched and keep their cooldown exit.
2. **Tighten** — keeper `attest CLOSED`. The oracle price falls by at most `CAP_BPS` (500 bps): a member at the
   76 % target LTV goes to ≈ 80 %, still under the 86 % LLTV, so an attestation — even a malicious one —
   cannot liquidate a position that was at target. Positions above target are exactly the ones the unwind is
   for.
3. **Sunset** — a Morpho market is immutable, so a bad oracle cannot be swapped: deploy a new set (step 4,
   version 2), set the old cap to 0, publish the new manifest and ask suppliers and members to move. The
   dashboard and the keeper follow whatever manifest they are pointed at.
4. **Feed dead** — nothing to do on-chain: the oracle fails closed, borrows and liquidations stop, and it
   resumes by itself when the feed does (`updatedAt` fresh again). Tell users; do not "fix" it with an
   attestation, which only tightens.
5. **Corporate action on the stock token** (`oraclePaused` / `effectiveAt` window) — `CORP_ACTION` is derived
   from the token itself, the oracle reverts for the window, and no one has to act.

## 12. Costs

| Item | Amount |
|---|---|
| Deployment, 24 tx | ≈ 25.3 M gas ≈ 0.0033 ETH at 0.13 gwei |
| Handover, 7 tx | < 0.0001 ETH |
| Keeper transaction | 0.1–0.3 M gas ≈ 0.00002–0.00004 ETH; a year of hourly pokes ≈ 0.3 ETH worst case |
| Keeper float | USDG for unwinds and liquidations (each returns collateral worth more than it paid) |
| Backstop seed | the team's first-loss deposit, sized to the initial coverage cap |

## 13. Compliance and counterparties

- **USDG** can freeze addresses (`isFrozen`, T13). A frozen supplier or backstop depositor cannot move funds
  until Paxos unfreezes them; Vigil holds USDG only in the premium escrow and the backstop, both of which only
  ever return funds to the address that deposited them.
- **The stock token** is Robinhood's, transfer-restricted through its registry; eligibility to hold it is
  Robinhood's decision, not the operator's. Vigil never custodies the stock token beyond the instant of a
  liquidation (Morpho holds the collateral).
- **The feeds** are Chainlink's; Vigil reads `latestRoundData` and judges freshness itself. The NVDA/USD feed
  has a 24 h heartbeat and 0.5 % deviation on trading days and is silent outside them, which is exactly the
  behaviour Vigil is built around.
- The operator is not a lender, a borrower or an issuer; the backstop is a first-loss deposit that its
  depositors can lose in full up to the coverage cap, and that must be said in the announcement.

## 14. Not done yet

- No mainnet transaction has been sent; the deployer holds 0 ETH on 4663.
- No external audit (`docs/AUDIT_SCOPE.md`).
- No Safe addresses chosen (the Safe contracts are on the chain, see G4); whether app.safe.global lists chain 4663 has not been checked.
- Whether the team can hold NVDA on mainnet (G5) has not been checked.
- The `keeper-status` workflow still points at the testnet manifest (by design until step 6).
