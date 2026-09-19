# Vigil — session-aware collateral risk layer untuk tokenized equity di Morpho Blue

> Robinhood Chain (Arbitrum Nitro) berjalan 24/7; feed harga equity Chainlink hanya 24/5 dan **beku sepanjang akhir pekan**.
> Dalam empat tahun data NVDA, dua-duanya gap yang akan menghasilkan bad debt di pasar LLTV 86% terjadi pada **open Senin**
> (5 Agu 2024 −14,2%, 27 Jan 2025 −12,5%). Kurva bunga berbasis utilisasi menagih nol untuk keduanya. Vigil memindahkan
> risiko itu menjadi angka — haircut ter-ramp sebelum close, premi ke tranche first-loss, soft unwind saat likuiditas masih
> ada — tanpa menyentuh core Morpho.

Spesifikasi lengkap: [`../vigil-prd-architecture.md`](../vigil-prd-architecture.md) (PRD v1.2). Kalibrasi empiris: [`../calibrator/report.md`](../calibrator/report.md).

## Arsitektur

```
 VigilCalendar ──► VigilSessionOracle ──► VigilRiskEngine ──► VigilOracle (Morpho IOracle) ──► Morpho market (NVDA/USDG)
 (jam ET, DST,      rezim, feedIsUsable,     H(L) ter-ramp,        harga × (1 − min(H, 500 bps))
  libur on-chain)   attest ≤ CLOSED,          event, π_ref, m(b)
                    index premi
 VigilPremium ──premi──► VigilBackstop (ERC-4626, first-loss) ──cover──► VigilLossReporter.liquidateWithCover
 VigilPreLiquidation: soft unwind member pada H_soft = max(H, cap + 200 bps), Dutch berbasis waktu
```

| Kontrak | Peran | Baris |
|---|---|---|
| `VigilCalendar` | Kalender sesi bursa AS deterministik dari `block.timestamp` (DST 2022–2030 hardcode, libur hanya-tambah) | 183 |
| `VigilSessionOracle` | Rezim efektif (kalender + kesegaran feed + `oraclePaused`/`effectiveAt` + attestation keeper ≤ CLOSED), `feedIsUsable`, index premi piecewise | 363 |
| `VigilRiskEngine` | Risk surface per aset: `H(L) = clamp(H_floor + k·σ·eventMult·√(L/τ_night))`, ramp murni dari waktu, event terjadwal, tabel `π_ref(L)` & `m(b)` | 306 |
| `VigilOracle` | Morpho `IOracle`: revert hanya saat `CORP_ACTION` atau stale **tak terduga**; feed beku akhir pekan = normal | 102 |
| `VigilPremium` | Escrow USDG, `due = borrowed × m(b) × Δindex`, membership, delinquency | 251 |
| `VigilBackstop` | ERC-4626 USDG; keluar hanya request → 7 hari → claim saat MARKET pada harga saat claim; `coverBadDebt` | 145 |
| `VigilPreLiquidation` | Pola Morpho PreLiquidation (opt-in `setAuthorization`), ambang sadar-sesi, unwind parsial ke target LTV | 176 |
| `VigilLossReporter` | `liquidateWithCover`: backstop melunasi shortfall member **sebelum** seizure dalam satu tx — Morpho tidak pernah merealisasi bad debt | 209 |

Semua kontrak immutable (tanpa proxy/pause); peran: `guardian`, `calibrator`, `keeperSigner`, `lossReporter` (matriks di PRD §8.9).

## Menjalankan

```bash
forge install            # morpho-blue v1.0.0, openzeppelin-contracts v4.9.6, forge-std
forge build
forge test               # 70 test: unit, skenario (replay historis), invariant
forge coverage --report summary --no-match-coverage "(test|script|mocks)"   # 93% baris pada src/
forge script script/Demo.s.sol -vv                                         # tabel dua pasar (kontrol vs Vigil)
```

Demo (`script/Demo.s.sol`) men-deploy Morpho Blue dari source + dua pasar identik NVDA/USDG LLTV 86% dan me-replay dua Senin nyata:

| Replay | Kontrol: bad debt tersosialisasi | Vigil: bad debt | Vigil: apa yang terjadi |
|---|---|---|---|
| 5 Agu 2024 (107,27 → 92,06) | 40,59 USDG per posisi 1.072 USDG | **0** | member di-unwind Jumat 15:00 ke 76% (diskon 1,5%), haircut pasar 500 bps sepanjang akhir pekan |
| 27 Jan 2025 (142,62 → 124,80) | 30,95 USDG per posisi | **0** | idem |
| Member max-LTV terkena −12% Senin 10:00 | — | **0** | shortfall 70,12 USDG dicover backstop dalam tx likuidasi; pemasok utuh |

## Deploy

Testnet 46630 **tidak** memiliki Morpho, Chainlink, maupun stock token (verifikasi on-chain 19 Sep 2026) → script memakai mock untuk yang tidak diberikan lewat env. Mainnet 4663 memiliki semuanya (alamat di header `script/Deploy.s.sol`).

```bash
# simulasi (tanpa kunci)
forge script script/Deploy.s.sol --rpc-url robinhood_testnet
# broadcast (butuh ETH testnet dari faucet.testnet.chain.robinhood.com)
forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast --private-key $PRIVATE_KEY
```

Setiap kontrak < 13 KB; script men-deploy per kontrak dari EOA (tidak bergantung pada batas ukuran kontrak chain).

## Hasil verifikasi Hari 1 (19 Sep 2026, `cast` ke RPC resmi)

| # | Item | Hasil |
|---|---|---|
| V1 | Chain ID | testnet 46630, mainnet 4663 ✅ |
| V3 | Morpho Blue | mainnet `0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010` (IRM `0x2BD3…0fa1`) ✅; **testnet: tidak ada** → deploy sendiri |
| V4 | LLTV enabled (mainnet) | 62,5 / 77 / 86 / 91,5 / 96,5% ✅ |
| V5 | USDG | mainnet `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, **6 desimal** → `SCALE_FACTOR = 1e16` ✅ |
| V6 | Stock token (registry `api.robinhood.com/rhj/assets`) | NVDA `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC`, AAPL `0xaF3D…93f9`, TSLA `0x322F…3b2d` (mainnet saja) |
| V7 | Feed Chainlink | NVDA/USD `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15`, 8 desimal, **heartbeat 86.400 s, deviasi 0,5%**, tanpa heartbeat di luar jam |
| V7b | Perilaku `updatedAt` | Jumat 21:42 ET: NVDA terakhir 15:55, AAPL 11:11, TSLA 15:48 — beku setelah close; AAPL diam 4,7 jam *di dalam* sesi |
| V8 | Sequencer uptime feed | tidak ada di 57 feed Robinhood Chain → `SEQ_UPTIME_FEED = 0` |
| V9 | USDG/USD feed | `0x61B7e5650328764B076A108EFF5fa7282a1B9aD2` ✅ → D1: pakai (`USDG_FEED` env) |
| V10 | ERC-8056 di token | `uiMultiplier` = 1,000775 (dividen), `newUIMultiplier`, `effectiveAt`, `oraclePaused` ada ✅; **V10b:** `newUIMultiplier() == uiMultiplier()` setelah `effectiveAt` → jendela post memakai `lastMultiplier` |
| V13 | USDG freeze | `isFrozen(address)` ada → T13 nyata |
| V14 | Morpho `repay(onBehalf)`/callback | bytecode kanonik ✅ |
| V12 | Batas ukuran kontrak | belum diverifikasi; tidak dibutuhkan (semua < 24 KB) |
| V15 | Kalender NYSE 2024–2027 | disematkan dari pengetahuan; **verifikasi di nyse.com sebelum mainnet** |

## Keputusan implementasi yang melengkapi PRD

- **Rule 3 (feed diam saat MARKET)** diukur sejak `max(updatedAt, lastOpen)` dengan `marketStaleSeconds` per aset (6 jam): feed beku sejak Jumat mendapat tenggang baru pada 09:30 Senin, dan saham tenang (AAPL) tidak salah diperketat.
- **Attestation keeper**: rezim berlaku sejak `closeAt`-nya; halt yang memajukan tutup wajib menamai rezim ≥ EXTENDED; ramp dimulai dari `issuedAt` (ditemukan oleh invariant fuzzer: tanpa ini, halt terjadwal 4 detik ke depan menjadi step).
- **INV-3** dinyatakan untuk **penurunan** harga (FR-11); pelepasan haircut saat attestation kedaluwarsa boleh seketika — tidak memengaruhi solvabilitas.
- **`liquidateWithCover`** memilih jalur dari sisa utang vs. `maxRepayable` setelah cover (bukan dari perbandingan `covered` yang rentan pembulatan); `DUST` 0,001 USDG menjamin seizure penuh tidak menyisakan bad debt.
- Index premi dipersistenkan pada setiap `accrue` (`poke` internal); ≤ 128 segmen kalender per panggilan.

Lint `forge build` melaporkan `unsafe-typecast` pada cast yang sudah dijaga (`answer > 0`, indeks hari < 2³², jumlah USDG < 2¹²⁸).
