# Vigil — Laporan kalibrasi cepat (§10.1 tahap 1)

Periode data: 2022-09-01 → 2026-09-19 (harian, Yahoo Finance via `yfinance`, OHLC ter-adjust split, belum ter-adjust dividen). Earnings: tanggal historis Yahoo, semua AMC (gap = close hari earnings → open berikutnya).
Parameter: LLTV = 0.86, LTV = 0.86, LIF = 1.0438, b_ref = 1 − LTV×LIF = 0.1023, markup = 1.5.
Definisi: `r` = ln(open/prev_close); `loss` = 1 − e^r; shortfall/C = max(loss − b, 0) (mengikuti §6.4; nilai Morpho eksak adalah ini ÷ LIF, ≈4% lebih kecil — diabaikan secara konservatif). Premi atas utang = markup × E[shortfall/C] / LTV.

Rezim: `night` = 1 hari kalender (L = 17,5 jam); `weekend` = 3 hari (L = 65,5 jam); `long` = 2 hari (libur tengah pekan, L = 41,5 jam) atau ≥ 4 hari (akhir pekan panjang, L ≥ 89,5 jam); `earnings` = gap setelah rilis AMC, apa pun harinya.


## NVDA

Sampel gap: 1014 (dibuang 0 artefak split |r| > 50%). Earnings dalam periode: 16.

### Distribusi per rezim

| Rezim | n | σ sampel | σ EWMA(0,94) | q01 | q05 | min | max | k = |q01|/σ | t-fit ν | loss > b_ref |
|---|---|---|---|---|---|---|---|---|---|---|
| night | 774 | 1.60% | 1.24% | -4.32% | -2.22% | -7.06% | 8.47% | 2.71 | 5.2 | 0 |
| weekend | 182 | 2.21% | 1.59% | -8.64% | -2.57% | -15.29% | 4.46% | 3.91 | 2.9 | 2 |
| long | 42 | 1.57% | 1.42% | -2.80% | -2.43% | -2.86% | 4.15% | 1.79 | 10.4 | 0 |
| earnings | 16 | 6.65% | 6.43% | -3.11% | -1.79% | -3.44% | 23.23% | 0.47 | 3.9 | 0 |

Rasio σ akhir pekan / σ malam biasa **empiris = 1.38×** vs model §6.2 `sqrt(65,5/17,5)` = 1.93×.
Rasio σ earnings / σ malam biasa = 4.17×.

### Premi per event atas utang (bp, termasuk markup), b = b_ref = 10,23%

| Rezim | E[shortfall]/C normal | E[shortfall]/C t-fit | E[shortfall]/C empiris | Premi normal | **Premi t-fit** | Premi empiris |
|---|---|---|---|---|---|---|
| night | 0.0000% | 0.0003% | 0.0000% | 0.00 | **0.06** | 0.00 |
| weekend | 0.0000% | 0.0067% | 0.0341% | 0.00 | **1.17** | 5.96 |
| long | 0.0000% | 0.0000% | 0.0000% | 0.00 | **0.00** | 0.00 |
| earnings | 0.1278% | 0.0976% | 0.0000% | 22.30 | **17.02** | 0.00 |

### Premi t-fit (bp atas utang) pada grid buffer b — bahan tabel `π_ref` × `m(b)` (§8.2)

| Rezim | b=4% | b=6% | b=8% | **b_ref=10.23%** | b=12% | b=15% | b=20% |
|---|---|---|---|---|---|---|---|
| night | 1.96 | 0.48 | 0.15 | 0.06 | 0.03 | 0.01 | 0.00 |
| weekend | 7.33 | 3.49 | 1.97 | 1.17 | 0.83 | 0.49 | 0.24 |
| long | 0.99 | 0.09 | 0.01 | 0.00 | 0.00 | 0.00 | 0.00 |
| earnings | 65.23 | 41.17 | 26.69 | 17.02 | 12.18 | 7.20 | 3.29 |

`m(b)` (dari rezim weekend, t-fit): b=4% → 6.24, b=6% → 2.97, b=8% → 1.68, b=10% → 1.00, b=12% → 0.70, b=15% → 0.42, b=20% → 0.21

### 8 gap negatif terbesar

| Tanggal open | Rezim | L (jam) | r | loss |
|---|---|---|---|---|
| 2024-08-05 (Mon) | weekend | 65.5 | -15.29% | 14.18% |
| 2025-01-27 (Mon) | weekend | 65.5 | -13.35% | 12.49% |
| 2025-04-07 (Mon) | weekend | 65.5 | -7.54% | 7.26% |
| 2025-04-16 (Wed) | night | 17.5 | -7.06% | 6.82% |
| 2025-04-03 (Thu) | night | 17.5 | -6.46% | 6.26% |
| 2024-08-02 (Fri) | night | 17.5 | -5.12% | 4.99% |
| 2022-09-13 (Tue) | night | 17.5 | -4.97% | 4.85% |
| 2022-10-07 (Fri) | night | 17.5 | -4.88% | 4.76% |

## AAPL

Sampel gap: 1014 (dibuang 0 artefak split |r| > 50%). Earnings dalam periode: 16.

### Distribusi per rezim

| Rezim | n | σ sampel | σ EWMA(0,94) | q01 | q05 | min | max | k = |q01|/σ | t-fit ν | loss > b_ref |
|---|---|---|---|---|---|---|---|---|---|---|
| night | 774 | 0.87% | 0.55% | -2.47% | -1.15% | -8.55% | 4.61% | 2.82 | 2.8 | 0 |
| weekend | 182 | 1.38% | 0.93% | -3.36% | -1.59% | -9.92% | 6.49% | 2.43 | 2.1 | 0 |
| long | 42 | 0.96% | 0.91% | -2.75% | -2.04% | -2.83% | 1.54% | 2.87 | 2.9 | 0 |
| earnings | 16 | 3.93% | 3.80% | -8.20% | -5.11% | -8.97% | 7.58% | 2.09 | 22.3 | 0 |

Rasio σ akhir pekan / σ malam biasa **empiris = 1.58×** vs model §6.2 `sqrt(65,5/17,5)` = 1.93×.
Rasio σ earnings / σ malam biasa = 4.49×.

### Premi per event atas utang (bp, termasuk markup), b = b_ref = 10,23%

| Rezim | E[shortfall]/C normal | E[shortfall]/C t-fit | E[shortfall]/C empiris | Premi normal | **Premi t-fit** | Premi empiris |
|---|---|---|---|---|---|---|
| night | 0.0000% | 0.0008% | 0.0000% | 0.00 | **0.14** | 0.00 |
| weekend | 0.0000% | 0.0075% | 0.0000% | 0.00 | **1.31** | 0.00 |
| long | 0.0000% | 0.0014% | 0.0000% | 0.00 | **0.24** | 0.00 |
| earnings | 0.0031% | 0.0051% | 0.0000% | 0.55 | **0.90** | 0.00 |

### Premi t-fit (bp atas utang) pada grid buffer b — bahan tabel `π_ref` × `m(b)` (§8.2)

| Rezim | b=4% | b=6% | b=8% | **b_ref=10.23%** | b=12% | b=15% | b=20% |
|---|---|---|---|---|---|---|---|
| night | 0.92 | 0.42 | 0.24 | 0.14 | 0.10 | 0.06 | 0.03 |
| weekend | 4.63 | 2.76 | 1.87 | 1.31 | 1.03 | 0.72 | 0.43 |
| long | 1.81 | 0.77 | 0.41 | 0.24 | 0.16 | 0.10 | 0.05 |
| earnings | 48.78 | 15.85 | 4.38 | 0.90 | 0.23 | 0.02 | 0.00 |

`m(b)` (dari rezim weekend, t-fit): b=4% → 3.54, b=6% → 2.11, b=8% → 1.43, b=10% → 1.00, b=12% → 0.78, b=15% → 0.55, b=20% → 0.33

### 8 gap negatif terbesar

| Tanggal open | Rezim | L (jam) | r | loss |
|---|---|---|---|---|
| 2024-08-05 (Mon) | weekend | 65.5 | -9.92% | 9.45% |
| 2026-07-31 (Fri) | earnings | 17.5 | -8.97% | 8.58% |
| 2025-04-03 (Thu) | night | 17.5 | -8.55% | 8.20% |
| 2025-04-07 (Mon) | weekend | 65.5 | -6.12% | 5.93% |
| 2025-04-10 (Thu) | night | 17.5 | -5.04% | 4.92% |
| 2025-04-04 (Fri) | night | 17.5 | -4.69% | 4.58% |
| 2023-09-07 (Thu) | night | 17.5 | -4.32% | 4.23% |
| 2025-05-23 (Fri) | night | 17.5 | -3.89% | 3.82% |

## TSLA

Sampel gap: 1014 (dibuang 0 artefak split |r| > 50%). Earnings dalam periode: 16.

### Distribusi per rezim

| Rezim | n | σ sampel | σ EWMA(0,94) | q01 | q05 | min | max | k = |q01|/σ | t-fit ν | loss > b_ref |
|---|---|---|---|---|---|---|---|---|---|---|
| night | 774 | 1.76% | 1.45% | -5.04% | -2.59% | -8.24% | 12.41% | 2.86 | 3.7 | 0 |
| weekend | 182 | 2.54% | 1.39% | -5.78% | -3.70% | -11.44% | 11.30% | 2.28 | 3.7 | 1 |
| long | 42 | 2.21% | 2.18% | -6.60% | -4.66% | -7.91% | 3.52% | 2.99 | 3.8 | 0 |
| earnings | 16 | 8.12% | 7.87% | -9.22% | -9.16% | -9.24% | 13.56% | 1.14 | ≥100 (≈normal) | 0 |

Rasio σ akhir pekan / σ malam biasa **empiris = 1.44×** vs model §6.2 `sqrt(65,5/17,5)` = 1.93×.
Rasio σ earnings / σ malam biasa = 4.61×.

### Premi per event atas utang (bp, termasuk markup), b = b_ref = 10,23%

| Rezim | E[shortfall]/C normal | E[shortfall]/C t-fit | E[shortfall]/C empiris | Premi normal | **Premi t-fit** | Premi empiris |
|---|---|---|---|---|---|---|
| night | 0.0000% | 0.0021% | 0.0000% | 0.00 | **0.36** | 0.00 |
| weekend | 0.0000% | 0.0076% | 0.0032% | 0.00 | **1.33** | 0.56 |
| long | 0.0000% | 0.0051% | 0.0000% | 0.00 | **0.89** | 0.00 |
| earnings | 0.3025% | 0.3645% | 0.0000% | 52.76 | **63.57** | 0.00 |

### Premi t-fit (bp atas utang) pada grid buffer b — bahan tabel `π_ref` × `m(b)` (§8.2)

| Rezim | b=4% | b=6% | b=8% | **b_ref=10.23%** | b=12% | b=15% | b=20% |
|---|---|---|---|---|---|---|---|
| night | 4.48 | 1.62 | 0.74 | 0.36 | 0.23 | 0.11 | 0.04 |
| weekend | 13.66 | 5.51 | 2.63 | 1.33 | 0.84 | 0.42 | 0.17 |
| long | 10.73 | 4.00 | 1.82 | 0.89 | 0.55 | 0.27 | 0.10 |
| earnings | 303.30 | 196.11 | 119.46 | 63.57 | 36.10 | 11.95 | 1.18 |

`m(b)` (dari rezim weekend, t-fit): b=4% → 10.25, b=6% → 4.13, b=8% → 1.98, b=10% → 1.00, b=12% → 0.63, b=15% → 0.32, b=20% → 0.12

### 8 gap negatif terbesar

| Tanggal open | Rezim | L (jam) | r | loss |
|---|---|---|---|---|
| 2024-08-05 (Mon) | weekend | 65.5 | -11.44% | 10.81% |
| 2026-07-23 (Thu) | earnings | 17.5 | -9.24% | 8.83% |
| 2024-01-25 (Thu) | earnings | 17.5 | -9.13% | 8.72% |
| 2024-07-24 (Wed) | earnings | 17.5 | -8.89% | 8.51% |
| 2023-04-20 (Thu) | earnings | 17.5 | -8.32% | 7.98% |
| 2023-03-02 (Thu) | night | 17.5 | -8.24% | 7.91% |
| 2024-10-11 (Fri) | night | 17.5 | -8.13% | 7.81% |
| 2025-07-07 (Mon) | long | 89.5 | -7.91% | 7.60% |

## AMD

Sampel gap: 1014 (dibuang 0 artefak split |r| > 50%). Earnings dalam periode: 16.

### Distribusi per rezim

| Rezim | n | σ sampel | σ EWMA(0,94) | q01 | q05 | min | max | k = |q01|/σ | t-fit ν | loss > b_ref |
|---|---|---|---|---|---|---|---|---|---|---|
| night | 774 | 1.97% | 2.50% | -5.82% | -2.90% | -8.40% | 9.80% | 2.95 | 3.1 | 0 |
| weekend | 182 | 3.03% | 3.32% | -5.99% | -3.06% | -8.13% | 31.86% | 1.97 | 2.9 | 0 |
| long | 42 | 1.72% | 1.97% | -2.87% | -2.52% | -3.05% | 3.62% | 1.67 | ≥100 (≈normal) | 0 |
| earnings | 16 | 7.30% | 7.07% | -11.67% | -10.83% | -11.88% | 14.21% | 1.60 | ≥100 (≈normal) | 1 |

Rasio σ akhir pekan / σ malam biasa **empiris = 1.54×** vs model §6.2 `sqrt(65,5/17,5)` = 1.93×.
Rasio σ earnings / σ malam biasa = 3.70×.

### Premi per event atas utang (bp, termasuk markup), b = b_ref = 10,23%

| Rezim | E[shortfall]/C normal | E[shortfall]/C t-fit | E[shortfall]/C empiris | Premi normal | **Premi t-fit** | Premi empiris |
|---|---|---|---|---|---|---|
| night | 0.0000% | 0.0064% | 0.0000% | 0.00 | **1.11** | 0.00 |
| weekend | 0.0001% | 0.0098% | 0.0000% | 0.02 | **1.72** | 0.00 |
| long | 0.0000% | 0.0000% | 0.0000% | 0.00 | **0.00** | 0.00 |
| earnings | 0.1964% | 0.2891% | 0.0605% | 34.25 | **50.42** | 10.55 |

### Premi t-fit (bp atas utang) pada grid buffer b — bahan tabel `π_ref` × `m(b)` (§8.2)

| Rezim | b=4% | b=6% | b=8% | **b_ref=10.23%** | b=12% | b=15% | b=20% |
|---|---|---|---|---|---|---|---|
| night | 8.32 | 3.69 | 1.97 | 1.11 | 0.75 | 0.43 | 0.20 |
| weekend | 10.74 | 5.13 | 2.89 | 1.72 | 1.21 | 0.72 | 0.35 |
| long | 0.57 | 0.01 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| earnings | 287.86 | 178.23 | 102.64 | 50.42 | 26.48 | 7.42 | 0.50 |

`m(b)` (dari rezim weekend, t-fit): b=4% → 6.25, b=6% → 2.98, b=8% → 1.68, b=10% → 1.00, b=12% → 0.70, b=15% → 0.42, b=20% → 0.20

### 8 gap negatif terbesar

| Tanggal open | Rezim | L (jam) | r | loss |
|---|---|---|---|---|
| 2026-02-04 (Wed) | earnings | 17.5 | -11.88% | 11.20% |
| 2025-02-05 (Wed) | earnings | 17.5 | -10.48% | 9.95% |
| 2025-04-16 (Wed) | night | 17.5 | -8.40% | 8.06% |
| 2024-10-30 (Wed) | earnings | 17.5 | -8.30% | 7.96% |
| 2024-08-05 (Mon) | weekend | 65.5 | -8.13% | 7.80% |
| 2026-06-23 (Tue) | night | 17.5 | -8.03% | 7.71% |
| 2023-05-03 (Wed) | earnings | 17.5 | -7.35% | 7.08% |
| 2026-04-28 (Tue) | night | 17.5 | -7.05% | 6.80% |

## AMZN

Sampel gap: 1014 (dibuang 0 artefak split |r| > 50%). Earnings dalam periode: 16.

### Distribusi per rezim

| Rezim | n | σ sampel | σ EWMA(0,94) | q01 | q05 | min | max | k = |q01|/σ | t-fit ν | loss > b_ref |
|---|---|---|---|---|---|---|---|---|---|---|
| night | 774 | 1.22% | 1.05% | -3.54% | -1.83% | -6.87% | 7.60% | 2.90 | 2.7 | 0 |
| weekend | 182 | 1.42% | 1.27% | -4.06% | -1.83% | -8.51% | 8.75% | 2.87 | 2.4 | 0 |
| long | 42 | 0.97% | 1.03% | -2.36% | -1.92% | -2.42% | 1.86% | 2.42 | 2.3 | 0 |
| earnings | 16 | 7.94% | 7.69% | -12.12% | -10.54% | -12.51% | 11.80% | 1.53 | ≥100 (≈normal) | 1 |

Rasio σ akhir pekan / σ malam biasa **empiris = 1.16×** vs model §6.2 `sqrt(65,5/17,5)` = 1.93×.
Rasio σ earnings / σ malam biasa = 6.51×.

### Premi per event atas utang (bp, termasuk markup), b = b_ref = 10,23%

| Rezim | E[shortfall]/C normal | E[shortfall]/C t-fit | E[shortfall]/C empiris | Premi normal | **Premi t-fit** | Premi empiris |
|---|---|---|---|---|---|---|
| night | 0.0000% | 0.0027% | 0.0000% | 0.00 | **0.48** | 0.00 |
| weekend | 0.0000% | 0.0047% | 0.0000% | 0.00 | **0.81** | 0.00 |
| long | 0.0000% | 0.0052% | 0.0000% | 0.00 | **0.90** | 0.00 |
| earnings | 0.2769% | 0.2125% | 0.0957% | 48.29 | **37.06** | 16.69 |

### Premi t-fit (bp atas utang) pada grid buffer b — bahan tabel `π_ref` × `m(b)` (§8.2)

| Rezim | b=4% | b=6% | b=8% | **b_ref=10.23%** | b=12% | b=15% | b=20% |
|---|---|---|---|---|---|---|---|
| night | 2.76 | 1.33 | 0.77 | 0.48 | 0.34 | 0.21 | 0.11 |
| weekend | 3.66 | 1.97 | 1.24 | 0.81 | 0.61 | 0.40 | 0.22 |
| long | 3.89 | 2.13 | 1.35 | 0.90 | 0.69 | 0.46 | 0.26 |
| earnings | 211.43 | 129.89 | 74.75 | 37.06 | 19.78 | 5.83 | 0.46 |

`m(b)` (dari rezim weekend, t-fit): b=4% → 4.51, b=6% → 2.43, b=8% → 1.52, b=10% → 1.00, b=12% → 0.75, b=15% → 0.49, b=20% → 0.27

### 8 gap negatif terbesar

| Tanggal open | Rezim | L (jam) | r | loss |
|---|---|---|---|---|
| 2022-10-28 (Fri) | earnings | 17.5 | -12.51% | 11.76% |
| 2024-08-02 (Fri) | earnings | 17.5 | -9.88% | 9.41% |
| 2026-02-06 (Fri) | earnings | 17.5 | -9.41% | 8.98% |
| 2024-08-05 (Mon) | weekend | 65.5 | -8.51% | 8.15% |
| 2025-08-01 (Fri) | earnings | 17.5 | -7.49% | 7.22% |
| 2023-02-03 (Fri) | earnings | 17.5 | -7.02% | 6.78% |
| 2025-04-03 (Thu) | night | 17.5 | -6.87% | 6.64% |
| 2025-04-04 (Fri) | night | 17.5 | -6.52% | 6.31% |

## NFLX

Sampel gap: 1014 (dibuang 0 artefak split |r| > 50%). Earnings dalam periode: 16.

### Distribusi per rezim

| Rezim | n | σ sampel | σ EWMA(0,94) | q01 | q05 | min | max | k = |q01|/σ | t-fit ν | loss > b_ref |
|---|---|---|---|---|---|---|---|---|---|---|
| night | 775 | 1.06% | 1.64% | -2.66% | -1.20% | -5.51% | 10.87% | 2.51 | 2.7 | 0 |
| weekend | 182 | 0.89% | 0.88% | -3.39% | -1.34% | -4.43% | 2.36% | 3.83 | 3.3 | 0 |
| long | 41 | 1.09% | 1.04% | -1.56% | -1.20% | -1.62% | 4.79% | 1.43 | 3.0 | 0 |
| earnings | 16 | 8.93% | 8.65% | -12.48% | -11.58% | -12.70% | 15.63% | 1.40 | ≥100 (≈normal) | 2 |

Rasio σ akhir pekan / σ malam biasa **empiris = 0.84×** vs model §6.2 `sqrt(65,5/17,5)` = 1.93×.
Rasio σ earnings / σ malam biasa = 8.43×.

### Premi per event atas utang (bp, termasuk markup), b = b_ref = 10,23%

| Rezim | E[shortfall]/C normal | E[shortfall]/C t-fit | E[shortfall]/C empiris | Premi normal | **Premi t-fit** | Premi empiris |
|---|---|---|---|---|---|---|
| night | 0.0000% | 0.0017% | 0.0000% | 0.00 | **0.29** | 0.00 |
| weekend | 0.0000% | 0.0004% | 0.0000% | 0.00 | **0.06** | 0.00 |
| long | 0.0000% | 0.0010% | 0.0000% | 0.00 | **0.18** | 0.00 |
| earnings | 0.4257% | 0.3366% | 0.1291% | 74.26 | **58.71** | 22.52 |

### Premi t-fit (bp atas utang) pada grid buffer b — bahan tabel `π_ref` × `m(b)` (§8.2)

| Rezim | b=4% | b=6% | b=8% | **b_ref=10.23%** | b=12% | b=15% | b=20% |
|---|---|---|---|---|---|---|---|
| night | 1.70 | 0.81 | 0.47 | 0.29 | 0.21 | 0.13 | 0.07 |
| weekend | 0.64 | 0.25 | 0.12 | 0.06 | 0.04 | 0.02 | 0.01 |
| long | 1.42 | 0.60 | 0.32 | 0.18 | 0.12 | 0.07 | 0.03 |
| earnings | 261.12 | 171.18 | 106.55 | 58.71 | 34.59 | 12.46 | 1.52 |

`m(b)` (dari rezim weekend, t-fit): b=4% → 9.92, b=6% → 3.80, b=8% → 1.87, b=10% → 1.00, b=12% → 0.66, b=15% → 0.36, b=20% → 0.16

### 8 gap negatif terbesar

| Tanggal open | Rezim | L (jam) | r | loss |
|---|---|---|---|---|
| 2026-07-17 (Fri) | earnings | 17.5 | -12.70% | 11.93% |
| 2026-04-17 (Fri) | earnings | 17.5 | -11.20% | 10.59% |
| 2025-10-22 (Wed) | earnings | 17.5 | -8.26% | 7.93% |
| 2024-04-19 (Fri) | earnings | 17.5 | -7.25% | 6.99% |
| 2023-07-20 (Thu) | earnings | 17.5 | -6.62% | 6.41% |
| 2026-01-21 (Wed) | earnings | 17.5 | -5.59% | 5.43% |
| 2026-09-18 (Fri) | night | 17.5 | -5.51% | 5.36% |
| 2022-12-15 (Thu) | night | 17.5 | -5.07% | 4.94% |

## PLTR

Sampel gap: 1014 (dibuang 0 artefak split |r| > 50%). Earnings dalam periode: 16.

### Distribusi per rezim

| Rezim | n | σ sampel | σ EWMA(0,94) | q01 | q05 | min | max | k = |q01|/σ | t-fit ν | loss > b_ref |
|---|---|---|---|---|---|---|---|---|---|---|
| night | 774 | 1.87% | 1.39% | -4.92% | -2.86% | -8.52% | 15.84% | 2.62 | 3.5 | 0 |
| weekend | 182 | 2.45% | 1.82% | -7.71% | -2.90% | -12.93% | 7.87% | 3.14 | 2.8 | 1 |
| long | 42 | 1.79% | 1.71% | -3.47% | -2.47% | -3.58% | 5.63% | 1.94 | 7.6 | 0 |
| earnings | 16 | 10.96% | 10.61% | -13.02% | -10.44% | -13.67% | 20.51% | 1.19 | ≥100 (≈normal) | 1 |

Rasio σ akhir pekan / σ malam biasa **empiris = 1.31×** vs model §6.2 `sqrt(65,5/17,5)` = 1.93×.
Rasio σ earnings / σ malam biasa = 5.85×.

### Premi per event atas utang (bp, termasuk markup), b = b_ref = 10,23%

| Rezim | E[shortfall]/C normal | E[shortfall]/C t-fit | E[shortfall]/C empiris | Premi normal | **Premi t-fit** | Premi empiris |
|---|---|---|---|---|---|---|
| night | 0.0000% | 0.0033% | 0.0000% | 0.00 | **0.58** | 0.00 |
| weekend | 0.0000% | 0.0151% | 0.0104% | 0.00 | **2.64** | 1.82 |
| long | 0.0000% | 0.0001% | 0.0000% | 0.00 | **0.02** | 0.00 |
| earnings | 0.8043% | 0.2362% | 0.1589% | 140.28 | **41.19** | 27.72 |

### Premi t-fit (bp atas utang) pada grid buffer b — bahan tabel `π_ref` × `m(b)` (§8.2)

| Rezim | b=4% | b=6% | b=8% | **b_ref=10.23%** | b=12% | b=15% | b=20% |
|---|---|---|---|---|---|---|---|
| night | 6.01 | 2.33 | 1.12 | 0.58 | 0.37 | 0.19 | 0.08 |
| weekend | 14.89 | 7.45 | 4.33 | 2.64 | 1.89 | 1.15 | 0.58 |
| long | 3.36 | 0.51 | 0.10 | 0.02 | 0.01 | 0.00 | 0.00 |
| earnings | 162.95 | 109.31 | 70.54 | 41.19 | 25.81 | 10.68 | 1.84 |

`m(b)` (dari rezim weekend, t-fit): b=4% → 5.64, b=6% → 2.82, b=8% → 1.64, b=10% → 1.00, b=12% → 0.71, b=15% → 0.44, b=20% → 0.22

### 8 gap negatif terbesar

| Tanggal open | Rezim | L (jam) | r | loss |
|---|---|---|---|---|
| 2024-05-07 (Tue) | earnings | 17.5 | -13.67% | 12.77% |
| 2024-08-05 (Mon) | weekend | 65.5 | -12.93% | 12.13% |
| 2025-04-07 (Mon) | weekend | 65.5 | -10.47% | 9.94% |
| 2025-05-06 (Tue) | earnings | 17.5 | -9.36% | 8.94% |
| 2025-02-20 (Thu) | night | 17.5 | -8.52% | 8.17% |
| 2025-11-04 (Tue) | earnings | 17.5 | -7.57% | 7.29% |
| 2025-04-03 (Thu) | night | 17.5 | -7.35% | 7.09% |
| 2025-03-31 (Mon) | weekend | 65.5 | -7.06% | 6.81% |


## Tabel siap tempel — PRD §6.5 (NVDA, LLTV 86%, posisi max-LTV, markup 1,5)

| Skenario | n | `σ_gap` empiris | k empiris | Premi normal | **Premi t-fit** | Premi empiris | loss > 10,23% |
|---|---|---|---|---|---|---|---|
| Malam biasa | 774 | 1.60% | 2.7 | 0.00 bp | **0.06 bp** | 0.00 bp | 0 |
| Akhir pekan biasa | 182 | 2.21% | 3.9 | 0.00 bp | **1.17 bp** | 5.96 bp | 2 |
| Akhir pekan panjang / libur | 42 | 1.57% | 1.8 | 0.00 bp | **0.00 bp** | 0.00 bp | 0 |
| Malam earnings | 16 | 6.65% | 0.5 | 22.30 bp | **17.02 bp** | 0.00 bp | 0 |

Catatan: n earnings kecil (≈16 per ticker) — t-fit pada rezim ini bersifat indikatif; σ dan premi empirisnya yang dipakai untuk pitch, t-fit sebagai batas atas.
