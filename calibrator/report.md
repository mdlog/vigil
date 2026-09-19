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


## Tabel siap tempel — PRD §6.5 (NVDA, LLTV 86%, posisi max-LTV, markup 1,5)

| Skenario | n | `σ_gap` empiris | k empiris | Premi normal | **Premi t-fit** | Premi empiris | loss > 10,23% |
|---|---|---|---|---|---|---|---|
| Malam biasa | 774 | 1.60% | 2.7 | 0.00 bp | **0.06 bp** | 0.00 bp | 0 |
| Akhir pekan biasa | 182 | 2.21% | 3.9 | 0.00 bp | **1.17 bp** | 5.96 bp | 2 |
| Akhir pekan panjang / libur | 42 | 1.57% | 1.8 | 0.00 bp | **0.00 bp** | 0.00 bp | 0 |
| Malam earnings | 16 | 6.65% | 0.5 | 22.30 bp | **17.02 bp** | 0.00 bp | 0 |

Catatan: n earnings kecil (≈16 per ticker) — t-fit pada rezim ini bersifat indikatif; σ dan premi empirisnya yang dipakai untuk pitch, t-fit sebagai batas atas.
