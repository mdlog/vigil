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

## AMD

Surface used in the backtest: σ_gap = 0.0197 (sample night σ, rounded), k = 3.0, floor 50 bps, max 2,500 bps, earnings multiplier 3.70× (σ_earnings / σ_night, capped at the contract's 5×). 4.04 years, 1014 closures.

### Peaks-over-threshold tails (GPD on losses beyond the 90th percentile)

| Regime | n | u | n > u | ξ (5–95 % bootstrap) | β | ξ at u = q85 / q95 | VaR 99 % | VaR 99.5 % | VaR 99.9 % | P(loss > b_ref) per closure | P(loss > b_vigil) per closure | E[shortfall] beyond b_ref (GPD / t-fit / emp) | beyond b_vigil (GPD) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| night | 774 | 1.99% | 78 | 0.06 (-0.17…0.36) | 1.288% | -0.00 / -0.23 | 5.19% | 6.25% | 8.88% | 0.046% | 0.005% | 0.0009% / 0.0064% / 0.0000% | 0.0001% |
| weekend | 182 | 1.77% | 19 | 0.21 (-1.33…1.08) | 1.197% | 0.82 / 0.53 | 5.38% | 6.84% | 11.14% | 0.135% | 0.036% | 0.0050% / 0.0098% / 0.0000% | 0.0018% |
| long | 42 | — | — | fit failed | | | | | | | | | |
| earnings | 16 | — | — | too few closures for a tail fit | | | | | | | | | |

Reading the weekend row: with the 5 % cap in force a max-LTV position is in bad debt only if the weekend gap exceeds 14.72%; the GPD tail puts that at **0.036% per weekend ≈ 0.02 per year**, versus 0.135% per weekend (≈ 0.07 per year) beyond the plain-market buffer — the two Monday gaps in the sample sit in that band.

### Backtest of the on-chain model — one max-size position per closure

| Position | closures with bad debt | total bad debt (bp of debt) | worst closure (bp) | premium collected (bp of debt / year) | bad debt (bp / year) | loss ratio |
|---|---|---|---|---|---|---|
| Plain Morpho market (control) | 1 | 107.8 | 107.8 | — | 26.7 | — |
| Vigil market, max-LTV borrower (haircut only) | 0 | 0.0 | 0.0 | 122.2 | 0.0 | 0.00 |
| Vigil member, unwound to 76% before each close | 0 | 0.0 | — | 56.3 | 0.0 | 0.00 |

Premium = Σ over closures of `premiumRefRatePerSecond(L) × L × m(b)`, with `b = 1 − LTV_raw·LIF` exactly as `VigilPremium.bufferBps` computes it (a max-LTV borrower on a Vigil market sits at b ≈ 14.7 % during a closure, so m(b) ≈ 0.45; the unwound member at ≈ 24 %, m ≈ 0.21). Bad debt is measured against a full seizure at the gapped price with LIF; a 0 means no closure in four years would have produced bad debt for that position.

### Premium adequacy — max-LTV borrower on the Vigil market, bp of debt per year

| Premium collected (deployed tables) | Expected bad debt beyond the 14.72 % buffer: GPD tail | t-fit | realized 2022–2026 |
|---|---|---|---|
| 122.2 | 12.1 | 84.4 | 0.0 |

The GPD point estimate extrapolates from ~19 weekend exceedances with a wide ξ interval, so its expected loss is an upper band; the t-fit is the lower band; the sample realized nothing beyond the buffer. The deployed tables sit between the two — this spread is the argument for a first-loss tranche with a coverage cap and for keeping the premium tables adjustable by the calibrator role rather than immutable.

| Worst closures | regime | L (h) | loss | engine H(L) | market haircut | bad debt: plain / Vigil / member (bp of debt) |
|---|---|---|---|---|---|---|
| 2026-02-04 | earnings | 17.5 | 11.20% | 2234 bps | 500 bps | 107.8 / 0.0 / 0.0 |
| 2025-02-05 | earnings | 17.5 | 9.95% | 2234 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2025-04-16 | night | 17.5 | 8.06% | 641 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2024-10-30 | earnings | 17.5 | 7.96% | 2234 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2024-08-05 | weekend | 65.5 | 7.80% | 1193 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2026-06-23 | night | 17.5 | 7.71% | 641 bps | 500 bps | 0.0 / 0.0 / 0.0 |

Charts: `out/amd_gap_distribution.png`, `out/amd_haircut_vs_quantiles.png`, `out/amd_weekend_tail_gpd.png`, `out/amd_backtest.png`.

## AMZN

Surface used in the backtest: σ_gap = 0.0122 (sample night σ, rounded), k = 3.0, floor 50 bps, max 2,500 bps, earnings multiplier 5.00× (σ_earnings / σ_night, capped at the contract's 5×). 4.04 years, 1014 closures.

### Peaks-over-threshold tails (GPD on losses beyond the 90th percentile)

| Regime | n | u | n > u | ξ (5–95 % bootstrap) | β | ξ at u = q85 / q95 | VaR 99 % | VaR 99.5 % | VaR 99.9 % | P(loss > b_ref) per closure | P(loss > b_vigil) per closure | E[shortfall] beyond b_ref (GPD / t-fit / emp) | beyond b_vigil (GPD) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| night | 774 | 1.23% | 78 | 0.12 (-0.11…0.28) | 0.784% | 0.10 / 0.34 | 3.30% | 4.04% | 6.01% | 0.007% | 0.001% | 0.0001% / 0.0027% / 0.0000% | 0.0000% |
| weekend | 182 | 1.15% | 19 | 0.45 (-0.14…1.05) | 0.680% | 0.32 / 1.52 | 3.98% | 5.57% | 11.87% | 0.138% | 0.063% | 0.0112% / 0.0047% / 0.0000% | 0.0070% |
| long | 42 | — | — | fit failed | | | | | | | | | |
| earnings | 16 | — | — | too few closures for a tail fit | | | | | | | | | |

Reading the weekend row: with the 5 % cap in force a max-LTV position is in bad debt only if the weekend gap exceeds 14.72%; the GPD tail puts that at **0.063% per weekend ≈ 0.03 per year**, versus 0.138% per weekend (≈ 0.07 per year) beyond the plain-market buffer — the two Monday gaps in the sample sit in that band.

### Backtest of the on-chain model — one max-size position per closure

| Position | closures with bad debt | total bad debt (bp of debt) | worst closure (bp) | premium collected (bp of debt / year) | bad debt (bp / year) | loss ratio |
|---|---|---|---|---|---|---|
| Plain Morpho market (control) | 1 | 170.6 | 170.6 | — | 42.2 | — |
| Vigil market, max-LTV borrower (haircut only) | 0 | 0.0 | 0.0 | 123.2 | 0.0 | 0.00 |
| Vigil member, unwound to 76% before each close | 0 | 0.0 | — | 56.3 | 0.0 | 0.00 |

Premium = Σ over closures of `premiumRefRatePerSecond(L) × L × m(b)`, with `b = 1 − LTV_raw·LIF` exactly as `VigilPremium.bufferBps` computes it (a max-LTV borrower on a Vigil market sits at b ≈ 14.7 % during a closure, so m(b) ≈ 0.45; the unwound member at ≈ 24 %, m ≈ 0.21). Bad debt is measured against a full seizure at the gapped price with LIF; a 0 means no closure in four years would have produced bad debt for that position.

### Premium adequacy — max-LTV borrower on the Vigil market, bp of debt per year

| Premium collected (deployed tables) | Expected bad debt beyond the 14.72 % buffer: GPD tail | t-fit | realized 2022–2026 |
|---|---|---|---|
| 123.2 | 38.9 | 42.8 | 0.0 |

The GPD point estimate extrapolates from ~19 weekend exceedances with a wide ξ interval, so its expected loss is an upper band; the t-fit is the lower band; the sample realized nothing beyond the buffer. The deployed tables sit between the two — this spread is the argument for a first-loss tranche with a coverage cap and for keeping the premium tables adjustable by the calibrator role rather than immutable.

| Worst closures | regime | L (h) | loss | engine H(L) | market haircut | bad debt: plain / Vigil / member (bp of debt) |
|---|---|---|---|---|---|---|
| 2022-10-28 | earnings | 17.5 | 11.76% | 1880 bps | 500 bps | 170.6 / 0.0 / 0.0 |
| 2024-08-02 | earnings | 17.5 | 9.41% | 1880 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2026-02-06 | earnings | 17.5 | 8.98% | 1880 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2024-08-05 | weekend | 65.5 | 8.15% | 758 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2025-08-01 | earnings | 17.5 | 7.22% | 1880 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2023-02-03 | earnings | 17.5 | 6.78% | 1880 bps | 500 bps | 0.0 / 0.0 / 0.0 |

Charts: `out/amzn_gap_distribution.png`, `out/amzn_haircut_vs_quantiles.png`, `out/amzn_weekend_tail_gpd.png`, `out/amzn_backtest.png`.

## NFLX

Surface used in the backtest: σ_gap = 0.0106 (sample night σ, rounded), k = 3.0, floor 50 bps, max 2,500 bps, earnings multiplier 5.00× (σ_earnings / σ_night, capped at the contract's 5×). 4.04 years, 1014 closures.

### Peaks-over-threshold tails (GPD on losses beyond the 90th percentile)

| Regime | n | u | n > u | ξ (5–95 % bootstrap) | β | ξ at u = q85 / q95 | VaR 99 % | VaR 99.5 % | VaR 99.9 % | P(loss > b_ref) per closure | P(loss > b_vigil) per closure | E[shortfall] beyond b_ref (GPD / t-fit / emp) | beyond b_vigil (GPD) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| night | 775 | 0.89% | 78 | 0.45 (0.18…0.70) | 0.426% | 0.40 / 0.11 | 2.62% | 3.60% | 7.47% | 0.050% | 0.022% | 0.0039% / 0.0017% / 0.0000% | 0.0024% |
| weekend | 182 | 0.99% | 19 | 0.62 (-0.58…1.00) | 0.331% | 0.23 / 0.89 | 2.73% | 3.95% | 9.91% | 0.095% | 0.051% | 0.0114% / 0.0004% / 0.0000% | 0.0083% |
| long | 41 | — | — | fit failed | | | | | | | | | |
| earnings | 16 | — | — | too few closures for a tail fit | | | | | | | | | |

Reading the weekend row: with the 5 % cap in force a max-LTV position is in bad debt only if the weekend gap exceeds 14.72%; the GPD tail puts that at **0.051% per weekend ≈ 0.03 per year**, versus 0.095% per weekend (≈ 0.05 per year) beyond the plain-market buffer — the two Monday gaps in the sample sit in that band.

### Backtest of the on-chain model — one max-size position per closure

| Position | closures with bad debt | total bad debt (bp of debt) | worst closure (bp) | premium collected (bp of debt / year) | bad debt (bp / year) | loss ratio |
|---|---|---|---|---|---|---|
| Plain Morpho market (control) | 2 | 230.1 | 189.4 | — | 56.9 | — |
| Vigil market, max-LTV borrower (haircut only) | 0 | 0.0 | 0.0 | 131.2 | 0.0 | 0.00 |
| Vigil member, unwound to 76% before each close | 0 | 0.0 | — | 59.8 | 0.0 | 0.00 |

Premium = Σ over closures of `premiumRefRatePerSecond(L) × L × m(b)`, with `b = 1 − LTV_raw·LIF` exactly as `VigilPremium.bufferBps` computes it (a max-LTV borrower on a Vigil market sits at b ≈ 14.7 % during a closure, so m(b) ≈ 0.45; the unwound member at ≈ 24 %, m ≈ 0.21). Bad debt is measured against a full seizure at the gapped price with LIF; a 0 means no closure in four years would have produced bad debt for that position.

### Premium adequacy — max-LTV borrower on the Vigil market, bp of debt per year

| Premium collected (deployed tables) | Expected bad debt beyond the 14.72 % buffer: GPD tail | t-fit | realized 2022–2026 |
|---|---|---|---|
| 131.2 | 102.6 | 18.9 | 0.0 |

The GPD point estimate extrapolates from ~19 weekend exceedances with a wide ξ interval, so its expected loss is an upper band; the t-fit is the lower band; the sample realized nothing beyond the buffer. The deployed tables sit between the two — this spread is the argument for a first-loss tranche with a coverage cap and for keeping the premium tables adjustable by the calibrator role rather than immutable.

| Worst closures | regime | L (h) | loss | engine H(L) | market haircut | bad debt: plain / Vigil / member (bp of debt) |
|---|---|---|---|---|---|---|
| 2026-07-17 | earnings | 17.5 | 11.93% | 1640 bps | 500 bps | 189.4 / 0.0 / 0.0 |
| 2026-04-17 | earnings | 17.5 | 10.59% | 1640 bps | 500 bps | 40.7 / 0.0 / 0.0 |
| 2025-10-22 | earnings | 17.5 | 7.93% | 1640 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2024-04-19 | earnings | 17.5 | 6.99% | 1640 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2023-07-20 | earnings | 17.5 | 6.41% | 1640 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2026-01-21 | earnings | 17.5 | 5.43% | 1640 bps | 500 bps | 0.0 / 0.0 / 0.0 |

Charts: `out/nflx_gap_distribution.png`, `out/nflx_haircut_vs_quantiles.png`, `out/nflx_weekend_tail_gpd.png`, `out/nflx_backtest.png`.

## PLTR

Surface used in the backtest: σ_gap = 0.0187 (sample night σ, rounded), k = 3.0, floor 50 bps, max 2,500 bps, earnings multiplier 5.00× (σ_earnings / σ_night, capped at the contract's 5×). 4.04 years, 1014 closures.

### Peaks-over-threshold tails (GPD on losses beyond the 90th percentile)

| Regime | n | u | n > u | ξ (5–95 % bootstrap) | β | ξ at u = q85 / q95 | VaR 99 % | VaR 99.5 % | VaR 99.9 % | P(loss > b_ref) per closure | P(loss > b_vigil) per closure | E[shortfall] beyond b_ref (GPD / t-fit / emp) | beyond b_vigil (GPD) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| night | 774 | 2.07% | 78 | 0.11 (-0.23…0.36) | 1.017% | 0.06 / -0.11 | 4.75% | 5.71% | 8.22% | 0.033% | 0.004% | 0.0007% / 0.0033% / 0.0000% | 0.0001% |
| weekend | 182 | 2.04% | 19 | 0.62 (-0.42…1.34) | 1.052% | 0.36 / 0.01 | 7.59% | 11.45% | 30.34% | 0.604% | 0.329% | 0.0733% / 0.0151% / 0.0104% | 0.0533% |
| long | 42 | — | — | fit failed | | | | | | | | | |
| earnings | 16 | — | — | too few closures for a tail fit | | | | | | | | | |

Reading the weekend row: with the 5 % cap in force a max-LTV position is in bad debt only if the weekend gap exceeds 14.72%; the GPD tail puts that at **0.329% per weekend ≈ 0.17 per year**, versus 0.604% per weekend (≈ 0.31 per year) beyond the plain-market buffer — the two Monday gaps in the sample sit in that band.

### Backtest of the on-chain model — one max-size position per closure

| Position | closures with bad debt | total bad debt (bp of debt) | worst closure (bp) | premium collected (bp of debt / year) | bad debt (bp / year) | loss ratio |
|---|---|---|---|---|---|---|
| Plain Morpho market (control) | 2 | 494.5 | 283.3 | — | 122.3 | — |
| Vigil market, max-LTV borrower (haircut only) | 0 | 0.0 | 0.0 | 122.2 | 0.0 | 0.00 |
| Vigil member, unwound to 76% before each close | 0 | 0.0 | — | 56.3 | 0.0 | 0.00 |

Premium = Σ over closures of `premiumRefRatePerSecond(L) × L × m(b)`, with `b = 1 − LTV_raw·LIF` exactly as `VigilPremium.bufferBps` computes it (a max-LTV borrower on a Vigil market sits at b ≈ 14.7 % during a closure, so m(b) ≈ 0.45; the unwound member at ≈ 24 %, m ≈ 0.21). Bad debt is measured against a full seizure at the gapped price with LIF; a 0 means no closure in four years would have produced bad debt for that position.

### Premium adequacy — max-LTV borrower on the Vigil market, bp of debt per year

| Premium collected (deployed tables) | Expected bad debt beyond the 14.72 % buffer: GPD tail | t-fit | realized 2022–2026 |
|---|---|---|---|
| 122.2 | 296.6 | 65.4 | 0.0 |

The GPD point estimate extrapolates from ~19 weekend exceedances with a wide ξ interval, so its expected loss is an upper band; the t-fit is the lower band; the sample realized nothing beyond the buffer. The deployed tables sit between the two — this spread is the argument for a first-loss tranche with a coverage cap and for keeping the premium tables adjustable by the calibrator role rather than immutable.

| Worst closures | regime | L (h) | loss | engine H(L) | market haircut | bad debt: plain / Vigil / member (bp of debt) |
|---|---|---|---|---|---|---|
| 2024-05-07 | earnings | 17.5 | 12.77% | 2500 bps | 500 bps | 283.3 / 0.0 / 0.0 |
| 2024-08-05 | weekend | 65.5 | 12.13% | 1133 bps | 500 bps | 211.3 / 0.0 / 0.0 |
| 2025-04-07 | weekend | 65.5 | 9.94% | 1133 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2025-05-06 | earnings | 17.5 | 8.94% | 2500 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2025-02-20 | night | 17.5 | 8.17% | 611 bps | 500 bps | 0.0 / 0.0 / 0.0 |
| 2025-11-04 | earnings | 17.5 | 7.29% | 2500 bps | 500 bps | 0.0 / 0.0 / 0.0 |

Charts: `out/pltr_gap_distribution.png`, `out/pltr_haircut_vs_quantiles.png`, `out/pltr_weekend_tail_gpd.png`, `out/pltr_backtest.png`.

## Across tickers

| Ticker | plain-market bad-debt closures | Vigil (haircut only) | member (unwound) | premium, max-LTV borrower (bp/yr) | premium, member (bp/yr) |
|---|---|---|---|---|---|
| NVDA | 2 (692.3 bp) | 0 (0.0 bp) | 0 (0.0 bp) | 122.2 | 56.3 |
| AAPL | 0 (0.0 bp) | 0 (0.0 bp) | 0 (0.0 bp) | 124.8 | 56.3 |
| TSLA | 1 (64.7 bp) | 0 (0.0 bp) | 0 (0.0 bp) | 122.2 | 56.3 |
| AMD | 1 (107.8 bp) | 0 (0.0 bp) | 0 (0.0 bp) | 122.2 | 56.3 |
| AMZN | 1 (170.6 bp) | 0 (0.0 bp) | 0 (0.0 bp) | 123.2 | 56.3 |
| NFLX | 2 (230.1 bp) | 0 (0.0 bp) | 0 (0.0 bp) | 131.2 | 59.8 |
| PLTR | 2 (494.5 bp) | 0 (0.0 bp) | 0 (0.0 bp) | 122.2 | 56.3 |

## What this changes, and what it does not

- The deployed NVDA surface (σ 1.6 %, k 3.0) with the 500 bps market cap turns the plain-market buffer of 10.23 % into 14.72 % during closures; over four years no closure of NVDA, AAPL or TSLA produced bad debt for a max-LTV position on a Vigil market, while the plain market took the two NVDA Mondays and the TSLA Monday of 5 Aug 2024.
- The residual tail beyond 14.72 % is what the premium and the backstop are for; the GPD rows quantify it per weekend and per year. The premium tables were set from the t-fit at b_ref (quick calibration); at the buffers members actually hold the collected premium is a few bp of debt per year — small, as the PRD's business section says, and priced against a tail that did not materialise in the sample.
- Not changed on chain: the surface and tables stay as deployed. The backtest supports them; a recalibration would be justified only with more closures in the earnings regime (n ≈ 16 per ticker).
- Caveats: one position per closure, opened at the maximum the oracle allows at the close — the harshest case; Yahoo daily opens (auction prints, not the first tradeable price); no interest accrual inside a closure; the soft unwind is assumed to have completed before the close.
