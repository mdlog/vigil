# Vigil — full calibration (PRD §10.1, stage 2)

Data: daily OHLC 2022-09-01 → 2026-09-19 (Yahoo Finance, split-adjusted), earnings dates from Yahoo (AMC: the gap is the earnings close → next open). Regimes as in `report.md`. LLTV 0.86, LIF 1.0438, plain-market buffer b_ref = 1 − LLTV·LIF = **10.23%**; Vigil market buffer at the 500 bps cap = 1 − LLTV·(1 − 5 %)·LIF = **14.72%** (a max-LTV borrower on a Vigil market is only in bad debt beyond this).

The on-chain arithmetic (`closureHaircutBps`, `premiumRefRatePerSecond`, `bufferMultiplierWad`, `bufferBps`) is replicated integer-for-integer; `test_calibration.py` checks it against the Foundry fixture (`test/unit/CurveFixture.t.sol`).

## NVDA

Surface used in the backtest: σ_gap = 0.0160 (deployed NVDA surface), k = 3.0, floor 50 bps, max 2,500 bps, earnings multiplier 4.17× (σ_earnings / σ_night, capped at the contract's 5×). 4.04 years, 1014 closures.

### Peaks-over-threshold tails (GPD on losses beyond the 90th percentile)

| Regime | n | u | n > u | ξ (5–95 % bootstrap) | β | ξ at u = q85 / q95 | VaR 99 % | VaR 99.5 % | VaR 99.9 % | P(loss > b_ref) per closure | P(loss > b_vigil) per closure | E[shortfall] beyond b_ref (GPD / t-fit / emp) | beyond b_vigil (GPD) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| night | 774 | 1.73% | 78 | 0.18 (-0.10…0.41) | 0.766% | 0.04 / -0.12 | 3.93% | 4.78% | 7.23% | 0.022% | 0.004% | 0.0006% / 0.0003% / 0.0000% | 0.0002% |
| weekend | 182 | 1.74% | 19 | 0.61 (-0.07…1.43) | 1.088% | 0.73 / 0.92 | 7.43% | 11.37% | 30.49% | 0.594% | 0.328% | 0.0734% / 0.0067% / 0.0341% | 0.0537% |
| long | 42 | — | — | fit failed | | | | | | | | | |
| earnings | 16 | — | — | too few closures for a tail fit | | | | | | | | | |

Reading the weekend row: with the 5 % cap in force a max-LTV position is in bad debt only if the weekend gap exceeds 14.72%; the GPD tail puts that at **0.328% per weekend ≈ 0.17 per year**, versus 0.594% per weekend (≈ 0.31 per year) beyond the plain-market buffer — the two Monday gaps in the sample sit in that band.

### Backtest of the on-chain model — one max-size position per closure

| Position | closures with bad debt | total bad debt (bp of debt) | worst closure (bp) | premium collected (bp of debt / year) | bad debt (bp / year) | loss ratio |
|---|---|---|---|---|---|---|
| Plain Morpho market (control) | 2 | 692.3 | 440.0 | — | 171.2 | — |
| Vigil market, max-LTV borrower (haircut only) | 0 | 0.0 | 0.0 | 122.2 | 0.0 | 0.00 |
| Vigil member, unwound to 76% before each close | 0 | 0.0 | — | 56.3 | 0.0 | 0.00 |

Premium = Σ over closures of `premiumRefRatePerSecond(L) × L × m(b)`, with `b = 1 − LTV_raw·LIF` exactly as `VigilPremium.bufferBps` computes it (a max-LTV borrower on a Vigil market sits at b ≈ 14.7 % during a closure, so m(b) ≈ 0.45; the unwound member at ≈ 24 %, m ≈ 0.21). Bad debt is measured against a full seizure at the gapped price with LIF; a 0 means no closure in four years would have produced bad debt for that position.

### Premium adequacy — max-LTV borrower on the Vigil market, bp of debt per year

| Premium collected (deployed tables) | Expected bad debt beyond the 14.72 % buffer: GPD tail | t-fit | realized 2022–2026 |
|---|---|---|---|
| 122.2 | 299.2 | 17.8 | 0.0 |

The GPD point estimate extrapolates from ~19 weekend exceedances with a wide ξ interval, so its expected loss is an upper band; the t-fit is the lower band; the sample realized nothing beyond the buffer. The deployed tables sit between the two — this spread is the argument for a first-loss tranche with a coverage cap and for keeping the premium tables adjustable by the calibrator role rather than immutable.

| Worst closures | regime | L (h) | loss | engine H(L) | market haircut | bad debt: plain / Vigil / member (bp of debt) |
|---|---|---|---|---|---|---|
| 2024-08-05 | weekend | 65.5 | 14.18% | 977 bps | 500 bps | 440.0 / 0.0 / 0.0 |
| 2025-01-27 | weekend | 65.5 | 12.49% | 977 bps | 500 bps | 252.3 / 0.0 / 0.0 |
| 2025-04-07 | weekend | 65.5 | 7.26% | 977 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2025-04-16 | night | 17.5 | 6.82% | 530 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2025-04-03 | night | 17.5 | 6.26% | 530 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2024-08-02 | night | 17.5 | 4.99% | 530 bps | 500 bps | 0.0 / 0.0 / 0.0 |

Charts: `out/nvda_gap_distribution.png`, `out/nvda_haircut_vs_quantiles.png`, `out/nvda_weekend_tail_gpd.png`, `out/nvda_backtest.png`.

## AAPL

Surface used in the backtest: σ_gap = 0.0087 (sample night σ, rounded), k = 3.0, floor 50 bps, max 2,500 bps, earnings multiplier 4.49× (σ_earnings / σ_night, capped at the contract's 5×). 4.04 years, 1014 closures.

### Peaks-over-threshold tails (GPD on losses beyond the 90th percentile)

| Regime | n | u | n > u | ξ (5–95 % bootstrap) | β | ξ at u = q85 / q95 | VaR 99 % | VaR 99.5 % | VaR 99.9 % | P(loss > b_ref) per closure | P(loss > b_vigil) per closure | E[shortfall] beyond b_ref (GPD / t-fit / emp) | beyond b_vigil (GPD) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| night | 774 | 0.87% | 78 | 0.58 (0.25…0.86) | 0.340% | 0.34 / 0.32 | 2.52% | 3.62% | 8.74% | 0.076% | 0.040% | 0.0084% / 0.0008% / 0.0000% | 0.0059% |
| weekend | 182 | 1.09% | 19 | 0.57 (-1.15…1.06) | 0.561% | 0.43 / 0.83 | 3.87% | 5.71% | 14.23% | 0.178% | 0.094% | 0.0199% / 0.0075% / 0.0000% | 0.0141% |
| long | 42 | — | — | fit failed | | | | | | | | | |
| earnings | 16 | — | — | too few closures for a tail fit | | | | | | | | | |

Reading the weekend row: with the 5 % cap in force a max-LTV position is in bad debt only if the weekend gap exceeds 14.72%; the GPD tail puts that at **0.094% per weekend ≈ 0.05 per year**, versus 0.178% per weekend (≈ 0.09 per year) beyond the plain-market buffer — the two Monday gaps in the sample sit in that band.

### Backtest of the on-chain model — one max-size position per closure

| Position | closures with bad debt | total bad debt (bp of debt) | worst closure (bp) | premium collected (bp of debt / year) | bad debt (bp / year) | loss ratio |
|---|---|---|---|---|---|---|
| Plain Morpho market (control) | 0 | 0.0 | 0.0 | — | 0.0 | — |
| Vigil market, max-LTV borrower (haircut only) | 0 | 0.0 | 0.0 | 124.8 | 0.0 | 0.00 |
| Vigil member, unwound to 76% before each close | 0 | 0.0 | — | 56.3 | 0.0 | 0.00 |

Premium = Σ over closures of `premiumRefRatePerSecond(L) × L × m(b)`, with `b = 1 − LTV_raw·LIF` exactly as `VigilPremium.bufferBps` computes it (a max-LTV borrower on a Vigil market sits at b ≈ 14.7 % during a closure, so m(b) ≈ 0.45; the unwound member at ≈ 24 %, m ≈ 0.21). Bad debt is measured against a full seizure at the gapped price with LIF; a 0 means no closure in four years would have produced bad debt for that position.

### Premium adequacy — max-LTV borrower on the Vigil market, bp of debt per year

| Premium collected (deployed tables) | Expected bad debt beyond the 14.72 % buffer: GPD tail | t-fit | realized 2022–2026 |
|---|---|---|---|
| 124.8 | 216.6 | 32.2 | 0.0 |

The GPD point estimate extrapolates from ~19 weekend exceedances with a wide ξ interval, so its expected loss is an upper band; the t-fit is the lower band; the sample realized nothing beyond the buffer. The deployed tables sit between the two — this spread is the argument for a first-loss tranche with a coverage cap and for keeping the premium tables adjustable by the calibrator role rather than immutable.

| Worst closures | regime | L (h) | loss | engine H(L) | market haircut | bad debt: plain / Vigil / member (bp of debt) |
|---|---|---|---|---|---|---|
| 2024-08-05 | weekend | 65.5 | 9.45% | 554 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2026-07-31 | earnings | 17.5 | 8.58% | 1220 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2025-04-03 | night | 17.5 | 8.20% | 308 bps | 308 bps | 0.0 / 0.0 / 0.0 |
| 2025-04-07 | weekend | 65.5 | 5.93% | 554 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2025-04-10 | night | 17.5 | 4.92% | 308 bps | 308 bps | 0.0 / 0.0 / 0.0 |
| 2025-04-04 | night | 17.5 | 4.58% | 308 bps | 308 bps | 0.0 / 0.0 / 0.0 |

Charts: `out/aapl_gap_distribution.png`, `out/aapl_haircut_vs_quantiles.png`, `out/aapl_weekend_tail_gpd.png`, `out/aapl_backtest.png`.

## TSLA

Surface used in the backtest: σ_gap = 0.0176 (sample night σ, rounded), k = 3.0, floor 50 bps, max 2,500 bps, earnings multiplier 4.61× (σ_earnings / σ_night, capped at the contract's 5×). 4.04 years, 1014 closures.

### Peaks-over-threshold tails (GPD on losses beyond the 90th percentile)

| Regime | n | u | n > u | ξ (5–95 % bootstrap) | β | ξ at u = q85 / q95 | VaR 99 % | VaR 99.5 % | VaR 99.9 % | P(loss > b_ref) per closure | P(loss > b_vigil) per closure | E[shortfall] beyond b_ref (GPD / t-fit / emp) | beyond b_vigil (GPD) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| night | 774 | 1.82% | 78 | 0.10 (-0.12…0.31) | 1.159% | 0.13 / -0.09 | 4.82% | 5.87% | 8.58% | 0.042% | 0.005% | 0.0009% / 0.0021% / 0.0000% | 0.0001% |
| weekend | 182 | 2.53% | 19 | 0.18 (-1.21…0.72) | 1.271% | 0.08 / 0.54 | 6.23% | 7.65% | 11.71% | 0.171% | 0.039% | 0.0055% / 0.0076% / 0.0032% | 0.0016% |
| long | 42 | — | — | fit failed | | | | | | | | | |
| earnings | 16 | — | — | too few closures for a tail fit | | | | | | | | | |

Reading the weekend row: with the 5 % cap in force a max-LTV position is in bad debt only if the weekend gap exceeds 14.72%; the GPD tail puts that at **0.039% per weekend ≈ 0.02 per year**, versus 0.171% per weekend (≈ 0.09 per year) beyond the plain-market buffer — the two Monday gaps in the sample sit in that band.

### Backtest of the on-chain model — one max-size position per closure

| Position | closures with bad debt | total bad debt (bp of debt) | worst closure (bp) | premium collected (bp of debt / year) | bad debt (bp / year) | loss ratio |
|---|---|---|---|---|---|---|
| Plain Morpho market (control) | 1 | 64.7 | 64.7 | — | 16.0 | — |
| Vigil market, max-LTV borrower (haircut only) | 0 | 0.0 | 0.0 | 122.2 | 0.0 | 0.00 |
| Vigil member, unwound to 76% before each close | 0 | 0.0 | — | 56.3 | 0.0 | 0.00 |

Premium = Σ over closures of `premiumRefRatePerSecond(L) × L × m(b)`, with `b = 1 − LTV_raw·LIF` exactly as `VigilPremium.bufferBps` computes it (a max-LTV borrower on a Vigil market sits at b ≈ 14.7 % during a closure, so m(b) ≈ 0.45; the unwound member at ≈ 24 %, m ≈ 0.21). Bad debt is measured against a full seizure at the gapped price with LIF; a 0 means no closure in four years would have produced bad debt for that position.

### Premium adequacy — max-LTV borrower on the Vigil market, bp of debt per year

| Premium collected (deployed tables) | Expected bad debt beyond the 14.72 % buffer: GPD tail | t-fit | realized 2022–2026 |
|---|---|---|---|
| 122.2 | 12.3 | 30.3 | 0.0 |

The GPD point estimate extrapolates from ~19 weekend exceedances with a wide ξ interval, so its expected loss is an upper band; the t-fit is the lower band; the sample realized nothing beyond the buffer. The deployed tables sit between the two — this spread is the argument for a first-loss tranche with a coverage cap and for keeping the premium tables adjustable by the calibrator role rather than immutable.

| Worst closures | regime | L (h) | loss | engine H(L) | market haircut | bad debt: plain / Vigil / member (bp of debt) |
|---|---|---|---|---|---|---|
| 2024-08-05 | weekend | 65.5 | 10.81% | 1070 bps | 500 bps | 64.7 / 0.0 / 0.0 |
| 2026-07-23 | earnings | 17.5 | 8.83% | 2480 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2024-01-25 | earnings | 17.5 | 8.72% | 2480 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2024-07-24 | earnings | 17.5 | 8.51% | 2480 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2023-04-20 | earnings | 17.5 | 7.98% | 2480 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2023-03-02 | night | 17.5 | 7.91% | 578 bps | 500 bps | 0.0 / 0.0 / 0.0 |

Charts: `out/tsla_gap_distribution.png`, `out/tsla_haircut_vs_quantiles.png`, `out/tsla_weekend_tail_gpd.png`, `out/tsla_backtest.png`.

## Across tickers

| Ticker | plain-market bad-debt closures | Vigil (haircut only) | member (unwound) | premium, max-LTV borrower (bp/yr) | premium, member (bp/yr) |
|---|---|---|---|---|---|
| NVDA | 2 (692.3 bp) | 0 (0.0 bp) | 0 (0.0 bp) | 122.2 | 56.3 |
| AAPL | 0 (0.0 bp) | 0 (0.0 bp) | 0 (0.0 bp) | 124.8 | 56.3 |
| TSLA | 1 (64.7 bp) | 0 (0.0 bp) | 0 (0.0 bp) | 122.2 | 56.3 |

## What this changes, and what it does not

- The deployed NVDA surface (σ 1.6 %, k 3.0) with the 500 bps market cap turns the plain-market buffer of 10.23 % into 14.72 % during closures; over four years no closure of NVDA, AAPL or TSLA produced bad debt for a max-LTV position on a Vigil market, while the plain market took the two NVDA Mondays and the TSLA Monday of 5 Aug 2024.
- The residual tail beyond 14.72 % is what the premium and the backstop are for; the GPD rows quantify it per weekend and per year. The premium tables were set from the t-fit at b_ref (quick calibration); at the buffers members actually hold the collected premium is a few bp of debt per year — small, as the PRD's business section says, and priced against a tail that did not materialise in the sample.
- Not changed on chain: the surface and tables stay as deployed. The backtest supports them; a recalibration would be justified only with more closures in the earnings regime (n ≈ 16 per ticker).
- Caveats: one position per closure, opened at the maximum the oracle allows at the close — the harshest case; Yahoo daily opens (auction prints, not the first tradeable price); no interest accrual inside a closure; the soft unwind is assumed to have completed before the close.
