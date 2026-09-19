#!/usr/bin/env python3
"""
Vigil — kalibrasi cepat (PRD §10.1, tahap 1).

Menghitung distribusi gap close-to-open per rezim (malam biasa / akhir pekan /
akhir pekan panjang / malam earnings) dan premi expected-shortfall untuk mengisi
tabel empiris §6.5. Tiga estimator dilaporkan berdampingan:
  - normal   : Bachelier, sigma = std sampel (rumus §6.4 apa adanya)
  - t-fit    : Student-t MLE per rezim, integral numerik   <- angka pitch
  - empiris  : rata-rata max(loss - b, 0) atas sampel      <- sanity check

Pakai:  python quick_calibration.py            (unduh via yfinance, cache ke data/)
        python quick_calibration.py --offline  (pakai cache)
Output: report.md di direktori ini.
"""
import argparse, math, os, sys, warnings
import numpy as np, pandas as pd
from scipy import stats, integrate

warnings.filterwarnings("ignore")
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")

TICKERS = ["NVDA", "AAPL", "TSLA"]
START, END = "2022-09-01", "2026-09-19"
LLTV, LTV, MARKUP = 0.86, 0.86, 1.5
LIF = min(1.15, 1 / (0.3 * LLTV + 0.7))
B_REF = 1 - LTV * LIF                      # 0.1023
TAU_NIGHT_H = 17.5                         # 16:00 -> 09:30 ET
EWMA_LAMBDA = 0.94
B_GRID = [0.04, 0.06, 0.08, B_REF, 0.12, 0.15, 0.20]


def load(tk, offline):
    px_path, ed_path = f"{DATA}/{tk}.csv", f"{DATA}/{tk}_earnings.csv"
    if offline or (os.path.exists(px_path) and os.path.exists(ed_path)):
        px = pd.read_csv(px_path, index_col=0, parse_dates=True)
        ed = pd.read_csv(ed_path, index_col=0, parse_dates=True)
        return px, pd.DatetimeIndex(ed.index)
    import yfinance as yf
    df = yf.download(tk, start=START, end=END, interval="1d", auto_adjust=False, progress=False)
    df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
    px = df[["Open", "High", "Low", "Close"]].copy()
    ed = yf.Ticker(tk).get_earnings_dates(limit=40)
    ed = ed[ed.index < pd.Timestamp(END, tz=ed.index.tz)]
    edi = pd.DatetimeIndex(ed.index.tz_localize(None).normalize()).sort_values().unique()
    os.makedirs(DATA, exist_ok=True)
    px.to_csv(px_path)
    pd.DataFrame(index=edi).to_csv(ed_path)
    return px, edi


def build_gaps(px, earnings):
    px = px.sort_index()
    g = pd.DataFrame({
        "prev_date": px.index[:-1], "date": px.index[1:],
        "prev_close": px["Close"].values[:-1], "open": px["Open"].values[1:],
    })
    g["r"] = np.log(g["open"] / g["prev_close"])          # log return close -> open
    g["loss"] = 1 - np.exp(g["r"])                         # kerugian sederhana (positif = turun)
    g["cal_days"] = (g["date"] - g["prev_date"]).dt.days
    g["L_hours"] = g["cal_days"] * 24 - 6.5                # closeAt 16:00 -> nextOpen 09:30
    # Earnings AMC: gap dari close hari earnings ke open berikutnya
    g["earnings"] = g["prev_date"].isin(earnings)
    def regime(row):
        if row.earnings: return "earnings"
        if row.cal_days == 1: return "night"
        if row.cal_days == 3: return "weekend"
        return "long"                                      # 2 hari (libur tengah pekan) atau >= 4 hari
    g["regime"] = g.apply(regime, axis=1)
    bad = g["r"].abs() > 0.5                               # artefak split yang tidak ter-adjust
    return g[~bad].reset_index(drop=True), int(bad.sum())


def ewma_sigma(r, lam=EWMA_LAMBDA):
    v = np.var(r[:20]) if len(r) >= 20 else np.var(r)
    for x in r[20:]:
        v = lam * v + (1 - lam) * x * x
    return math.sqrt(v)


def es_from_density(pdf, b, lo=-1.5):
    """E[max(1 - e^r - b, 0)] untuk densitas log-return pdf(r)."""
    hi = math.log(1 - b)
    val, _ = integrate.quad(lambda r: (1 - math.exp(r) - b) * pdf(r), lo, hi, limit=200)
    return max(val, 0.0)


def group_stats(r):
    r = np.asarray(r, dtype=float)
    n = len(r)
    sd = r.std(ddof=1) if n > 1 else float("nan")
    out = {"n": n, "mean": r.mean(), "sigma": sd, "sigma_ewma": ewma_sigma(r) if n >= 5 else float("nan"),
           "q01": np.quantile(r, 0.01), "q05": np.quantile(r, 0.05), "min": r.min(), "max": r.max()}
    out["k_emp"] = abs(out["q01"]) / sd if sd else float("nan")
    # t-fit (df dibatasi >= 2.1 agar varians ada)
    if n >= 8:
        df_, loc, scale = stats.t.fit(r)
        df_ = max(df_, 2.1)
        out["t_df"], out["t_loc"], out["t_scale"] = df_, loc, scale
        tpdf = lambda x: stats.t.pdf(x, df_, loc, scale)
    else:
        out["t_df"] = float("nan"); tpdf = None
    npdf = lambda x: stats.norm.pdf(x, 0.0, sd)
    es = {}
    for b in B_GRID:
        es_emp = np.mean(np.maximum(r * 0 + (1 - np.exp(r)) - b, 0))
        es_n = es_from_density(npdf, b)
        es_t = es_from_density(tpdf, b) if tpdf else float("nan")
        es[b] = {"emp": es_emp, "normal": es_n, "t": es_t,
                 "exceed": int(((1 - np.exp(r)) > b).sum())}
    out["es"] = es
    return out


def prem_bp(es):  # premi atas utang, bp, sudah termasuk markup (§6.4)
    return MARKUP * es / LTV * 1e4


def fmt(x, p=2):
    return "—" if (x is None or (isinstance(x, float) and math.isnan(x))) else f"{x:.{p}f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args()

    lines = []
    P = lines.append
    P("# Vigil — Laporan kalibrasi cepat (§10.1 tahap 1)\n")
    P(f"Periode data: {START} → {END} (harian, Yahoo Finance via `yfinance`, OHLC ter-adjust split, "
      f"belum ter-adjust dividen). Earnings: tanggal historis Yahoo, semua AMC (gap = close hari earnings → open berikutnya).")
    P(f"Parameter: LLTV = {LLTV:.2f}, LTV = {LTV:.2f}, LIF = {LIF:.4f}, b_ref = 1 − LTV×LIF = {B_REF:.4f}, markup = {MARKUP}.")
    P("Definisi: `r` = ln(open/prev_close); `loss` = 1 − e^r; shortfall/C = max(loss − b, 0) "
      "(mengikuti §6.4; nilai Morpho eksak adalah ini ÷ LIF, ≈4% lebih kecil — diabaikan secara konservatif). "
      "Premi atas utang = markup × E[shortfall/C] / LTV.\n")
    P("Rezim: `night` = 1 hari kalender (L = 17,5 jam); `weekend` = 3 hari (L = 65,5 jam); "
      "`long` = 2 hari (libur tengah pekan, L = 41,5 jam) atau ≥ 4 hari (akhir pekan panjang, L ≥ 89,5 jam); "
      "`earnings` = gap setelah rilis AMC, apa pun harinya.\n")

    summary_rows = {}
    for tk in TICKERS:
        px, earnings = load(tk, args.offline)
        g, nbad = build_gaps(px, earnings)
        P(f"\n## {tk}\n")
        P(f"Sampel gap: {len(g)} (dibuang {nbad} artefak split |r| > 50%). Earnings dalam periode: "
          f"{int(g['earnings'].sum())}.\n")
        P("### Distribusi per rezim\n")
        P("| Rezim | n | σ sampel | σ EWMA(0,94) | q01 | q05 | min | max | k = |q01|/σ | t-fit ν | loss > b_ref |")
        P("|---|---|---|---|---|---|---|---|---|---|---|")
        st = {}
        for rg in ["night", "weekend", "long", "earnings"]:
            r = g.loc[g.regime == rg, "r"].values
            if len(r) == 0:
                continue
            s = group_stats(r); st[rg] = s
            P(f"| {rg} | {s['n']} | {s['sigma']*100:.2f}% | {fmt(s['sigma_ewma']*100)}% | {s['q01']*100:.2f}% | "
              f"{s['q05']*100:.2f}% | {s['min']*100:.2f}% | {s['max']*100:.2f}% | {fmt(s['k_emp'])} | "
              f"{'≥100 (≈normal)' if s['t_df'] >= 100 else fmt(s['t_df'],1)} | {s['es'][B_REF]['exceed']} |")
        # skala waktu empiris
        if "night" in st and "weekend" in st:
            ratio = st["weekend"]["sigma"] / st["night"]["sigma"]
            P(f"\nRasio σ akhir pekan / σ malam biasa **empiris = {ratio:.2f}×** vs model §6.2 "
              f"`sqrt(65,5/17,5)` = {math.sqrt(65.5/17.5):.2f}×.")
        if "night" in st and "earnings" in st:
            P(f"Rasio σ earnings / σ malam biasa = {st['earnings']['sigma']/st['night']['sigma']:.2f}×.")

        P("\n### Premi per event atas utang (bp, termasuk markup), b = b_ref = 10,23%\n")
        P("| Rezim | E[shortfall]/C normal | E[shortfall]/C t-fit | E[shortfall]/C empiris | Premi normal | **Premi t-fit** | Premi empiris |")
        P("|---|---|---|---|---|---|---|")
        for rg, s in st.items():
            e = s["es"][B_REF]
            P(f"| {rg} | {e['normal']*100:.4f}% | {fmt(e['t']*100,4)}% | {e['emp']*100:.4f}% | "
              f"{prem_bp(e['normal']):.2f} | **{fmt(prem_bp(e['t']))}** | {prem_bp(e['emp']):.2f} |")

        P("\n### Premi t-fit (bp atas utang) pada grid buffer b — bahan tabel `π_ref` × `m(b)` (§8.2)\n")
        P("| Rezim | " + " | ".join(f"b={b*100:.0f}%" if b != B_REF else f"**b_ref={b*100:.2f}%**" for b in B_GRID) + " |")
        P("|---|" + "---|" * len(B_GRID))
        for rg, s in st.items():
            P(f"| {rg} | " + " | ".join(fmt(prem_bp(s['es'][b]['t'])) for b in B_GRID) + " |")
        if "weekend" in st and not math.isnan(st["weekend"]["es"][B_REF]["t"]):
            ref = st["weekend"]["es"][B_REF]["t"]
            P("\n`m(b)` (dari rezim weekend, t-fit): " + ", ".join(
                f"b={b*100:.0f}% → {st['weekend']['es'][b]['t']/ref:.2f}" for b in B_GRID if ref > 0))

        P("\n### 8 gap negatif terbesar\n")
        P("| Tanggal open | Rezim | L (jam) | r | loss |")
        P("|---|---|---|---|---|")
        for _, row in g.nsmallest(8, "r").iterrows():
            P(f"| {row.date.date()} ({row.date.strftime('%a')}) | {row.regime} | {row.L_hours:.1f} | "
              f"{row.r*100:.2f}% | {row.loss*100:.2f}% |")
        summary_rows[tk] = st

    # Tabel siap tempel untuk §6.5 (NVDA)
    st = summary_rows["NVDA"]
    P("\n\n## Tabel siap tempel — PRD §6.5 (NVDA, LLTV 86%, posisi max-LTV, markup 1,5)\n")
    P("| Skenario | n | `σ_gap` empiris | k empiris | Premi normal | **Premi t-fit** | Premi empiris | loss > 10,23% |")
    P("|---|---|---|---|---|---|---|---|")
    label = {"night": "Malam biasa", "weekend": "Akhir pekan biasa", "long": "Akhir pekan panjang / libur", "earnings": "Malam earnings"}
    for rg in ["night", "weekend", "long", "earnings"]:
        if rg not in st: continue
        s = st[rg]; e = s["es"][B_REF]
        P(f"| {label[rg]} | {s['n']} | {s['sigma']*100:.2f}% | {fmt(s['k_emp'],1)} | {prem_bp(e['normal']):.2f} bp | "
          f"**{fmt(prem_bp(e['t']))} bp** | {prem_bp(e['emp']):.2f} bp | {e['exceed']} |")
    P("\nCatatan: n earnings kecil (≈16 per ticker) — t-fit pada rezim ini bersifat indikatif; "
      "σ dan premi empirisnya yang dipakai untuk pitch, t-fit sebagai batas atas.")

    with open(os.path.join(HERE, "report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
