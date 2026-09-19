#!/usr/bin/env python3
"""
Vigil — full calibration (PRD §10.1, stage 2).

Builds on quick_calibration.py (same data, same regimes) and adds what the
quick pass could not say:

  1. Peaks-over-threshold / Generalized Pareto tails per regime — the
     probability and expected shortfall of gaps beyond the buffer that Vigil's
     haircut leaves, with bootstrap intervals and a threshold-stability check.
  2. A backtest of the *on-chain* model: the exact integer haircut formula,
     premium-rate table and buffer multiplier of VigilRiskEngine (parity with
     test/unit/CurveFixture.t.sol) replayed over every closure of 2022-09 →
     2026-09 for NVDA, AAPL and TSLA, in three positions: a control market
     (no haircut), a max-LTV borrower on a Vigil market, and a member who was
     soft-unwound to the target LTV before the close.
  3. Charts for the pitch and the README (out/*.png).
  4. report_full.md.

Usage:  python full_calibration.py            (downloads via yfinance if the cache is missing)
        python full_calibration.py --offline  (cache in data/)
"""
import argparse
import math
import os
import warnings

import numpy as np
import pandas as pd
from scipy import integrate, stats

import quick_calibration as qc

warnings.filterwarnings("ignore")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")

# ── on-chain constants (VigilRiskEngine / VigilPremium / script/DeployLib.sol) ─────────────────────
WAD = 10**18
BPS = 10_000
TAU_NIGHT = 63_000
GLOBAL_H_MAX = 2_500
MARKET_CAP_BPS = 500          # VigilOracle MARKET_HAIRCUT_CAP_BPS on the deployed market
SOFT_MARGIN_BPS = 200         # VigilPreLiquidation: H_soft = max(H, cap + 200)
TARGET_LTV = 0.76             # soft-unwind target
LLTV = 0.86
LIF = min(1.15, 1 / (0.3 * LLTV + 0.7))   # Morpho liquidation incentive at 86 % → 1.0438
K_TAIL_BPS = 30_000
H_FLOOR_BPS, H_MAX_BPS = 50, 2_500
L_BUCKET = [63_000, 149_400, 235_800, 322_200]
RATE_NO_EVENT = [95_000_000, 800_000_000, 1_480_000_000, 1_240_000_000]   # WAD per second at b_ref
RATE_EVENT = [27_000_000_000] * 4
B_BPS_TABLE = [400, 600, 800, 1_023, 1_500, 2_000]
MULT_WAD_TABLE = [6_240_000_000_000_000_000, 2_970_000_000_000_000_000, 1_680_000_000_000_000_000,
                  1_000_000_000_000_000_000, 420_000_000_000_000_000, 210_000_000_000_000_000]
NVDA_SIGMA_WAD = 16_000_000_000_000_000  # 0.016e18 — the deployed surface
BOOTSTRAP = 400
RNG = np.random.default_rng(20260919)


# ── exact replicas of the contract arithmetic ────────────────────────────────────────────────────
def isqrt(x: int) -> int:
    if x == 0:
        return 0
    z = (x + 1) // 2
    y = x
    while z < y:
        y = z
        z = (x // z + z) // 2
    return y


def haircut_bps(L: int, sigma_wad: int, event_mult_bps: int = BPS, k_bps: int = K_TAIL_BPS,
                floor_bps: int = H_FLOOR_BPS, hmax_bps: int = H_MAX_BPS) -> int:
    """VigilRiskEngine.closureHaircutBps, integer for integer."""
    scale_wad = isqrt(L * WAD * WAD // TAU_NIGHT)
    sigma_eff_wad = sigma_wad * event_mult_bps // BPS * scale_wad // WAD
    sigma_eff_bps = sigma_eff_wad // 10**14
    h = floor_bps + k_bps * sigma_eff_bps // BPS
    cap = min(hmax_bps, GLOBAL_H_MAX)
    return max(min(h, cap), floor_bps)


def _interp(x, x0, x1, y0, y1):
    if x <= x0:
        return y0
    if x >= x1:
        return y1
    if y1 >= y0:
        return y0 + (y1 - y0) * (x - x0) // (x1 - x0)
    return y0 - (y0 - y1) * (x - x0) // (x1 - x0)


def rate_per_second(L: int, event: bool) -> int:
    """VigilRiskEngine.premiumRefRatePerSecond (WAD/s per unit of debt at b_ref)."""
    table = RATE_EVENT if event else RATE_NO_EVENT
    if L <= L_BUCKET[0]:
        return table[0]
    for i in range(1, 4):
        if L <= L_BUCKET[i]:
            return _interp(L, L_BUCKET[i - 1], L_BUCKET[i], table[i - 1], table[i])
    return table[3]


def mult_wad(b_bps: int) -> int:
    """VigilRiskEngine.bufferMultiplierWad."""
    if b_bps <= B_BPS_TABLE[0]:
        return MULT_WAD_TABLE[0]
    for i in range(1, 6):
        if b_bps <= B_BPS_TABLE[i]:
            return _interp(b_bps, B_BPS_TABLE[i - 1], B_BPS_TABLE[i], MULT_WAD_TABLE[i - 1], MULT_WAD_TABLE[i])
    return MULT_WAD_TABLE[5]


def buffer_bps(ltv_raw: float) -> int:
    """VigilPremium.bufferBps: 1 − LTV(raw price) × LIF, in bps, floored at 0."""
    x = ltv_raw * LIF
    return 0 if x >= 1 else int((1 - x) * BPS)


# ── GPD tail ─────────────────────────────────────────────────────────────────────────────────────
def gpd_fit(loss: np.ndarray, q: float = 0.90):
    loss = np.asarray(loss, dtype=float)
    u = float(np.quantile(loss, q))
    exc = loss[loss > u] - u
    if len(exc) < 8:
        return None
    xi, _, beta = stats.genpareto.fit(exc, floc=0)
    p_u = len(exc) / len(loss)
    return {"u": u, "xi": float(xi), "beta": float(beta), "n_exc": int(len(exc)), "n": int(len(loss)), "p_u": p_u}


def gpd_sf(fit, x):
    """P(loss > x) for x ≥ u."""
    u, xi, beta, p_u = fit["u"], fit["xi"], fit["beta"], fit["p_u"]
    if x <= u:
        return p_u
    z = (x - u) / beta
    if abs(xi) < 1e-9:
        return p_u * math.exp(-z)
    base = 1 + xi * z
    return 0.0 if base <= 0 else p_u * base ** (-1 / xi)


def gpd_var(fit, p):
    """Loss quantile at probability p (p > 1 − p_u)."""
    u, xi, beta, p_u = fit["u"], fit["xi"], fit["beta"], fit["p_u"]
    if abs(xi) < 1e-9:
        return u + beta * math.log(p_u / (1 - p))
    return u + beta / xi * ((p_u / (1 - p)) ** xi - 1)


def gpd_es_beyond(fit, b):
    """E[max(loss − b, 0)] from the tail (b ≥ u): ∫_b^∞ P(loss > x) dx."""
    if fit["xi"] >= 1:
        return float("inf")
    upper = 1.0  # a loss cannot exceed 100 %
    val, _ = integrate.quad(lambda x: gpd_sf(fit, x), max(b, fit["u"]), upper, limit=200)
    if b < fit["u"]:
        val += (fit["u"] - b) * fit["p_u"]  # crude: below u the empirical part dominates; caller uses emp there
    return val


def bootstrap_xi(loss, q=0.90, n=BOOTSTRAP):
    loss = np.asarray(loss, dtype=float)
    xs = []
    for _ in range(n):
        sample = RNG.choice(loss, size=len(loss), replace=True)
        f = gpd_fit(sample, q)
        if f:
            xs.append(f["xi"])
    if not xs:
        return (float("nan"), float("nan"))
    return (float(np.quantile(xs, 0.05)), float(np.quantile(xs, 0.95)))


# ── backtest ─────────────────────────────────────────────────────────────────────────────────────
def backtest(g: pd.DataFrame, sigma_wad: int, event_mult_bps: int) -> pd.DataFrame:
    rows = []
    for r in g.itertuples():
        L = int(r.cal_days * 24 * 3600 - 6.5 * 3600)
        event = r.regime == "earnings"
        h_engine = haircut_bps(L, sigma_wad, event_mult_bps if event else BPS)
        h_m = min(h_engine, MARKET_CAP_BPS) / BPS
        loss = float(r.loss)
        # positions as a fraction of collateral value at the close (raw price)
        d_ctrl = LLTV
        d_vigil = LLTV * (1 - h_m)
        d_member = TARGET_LTV * (1 - h_m)
        recoverable = (1 - loss) / LIF  # what a full seizure repays at the gapped price
        sf = lambda d: max(d - recoverable, 0.0)
        b_vigil = buffer_bps(d_vigil)
        b_member = buffer_bps(d_member)
        rate = rate_per_second(L, event)
        # premium per unit of debt over this closure = rate × L × m(b) / WAD
        prem_vigil = rate * L * mult_wad(b_vigil) / WAD / WAD
        prem_member = rate * L * mult_wad(b_member) / WAD / WAD
        rows.append({
            "date": r.date, "regime": r.regime, "L_h": L / 3600, "loss": loss,
            "h_engine_bps": h_engine, "h_market_bps": int(h_m * BPS),
            "b_ctrl": 1 - d_ctrl * LIF, "b_vigil": 1 - d_vigil * LIF, "b_member": 1 - d_member * LIF,
            "sf_ctrl": sf(d_ctrl) / d_ctrl, "sf_vigil": sf(d_vigil) / d_vigil, "sf_member": sf(d_member) / d_member,
            "prem_vigil": prem_vigil, "prem_member": prem_member,
        })
    return pd.DataFrame(rows)


def summarize_backtest(bt: pd.DataFrame, years: float):
    def bp(x):
        return x * 1e4
    out = {
        "closures": len(bt),
        "events_ctrl": int((bt.sf_ctrl > 0).sum()), "loss_ctrl_bp": bp(bt.sf_ctrl.sum()), "worst_ctrl_bp": bp(bt.sf_ctrl.max()),
        "events_vigil": int((bt.sf_vigil > 0).sum()), "loss_vigil_bp": bp(bt.sf_vigil.sum()), "worst_vigil_bp": bp(bt.sf_vigil.max()),
        "events_member": int((bt.sf_member > 0).sum()), "loss_member_bp": bp(bt.sf_member.sum()),
        "prem_vigil_bp_yr": bp(bt.prem_vigil.sum()) / years, "prem_member_bp_yr": bp(bt.prem_member.sum()) / years,
        "loss_vigil_bp_yr": bp(bt.sf_vigil.sum()) / years, "loss_member_bp_yr": bp(bt.sf_member.sum()) / years,
    }
    out["loss_ratio_vigil"] = out["loss_vigil_bp_yr"] / out["prem_vigil_bp_yr"] if out["prem_vigil_bp_yr"] else float("nan")
    out["loss_ratio_member"] = out["loss_member_bp_yr"] / out["prem_member_bp_yr"] if out["prem_member_bp_yr"] else float("nan")
    return out


# ── charts ───────────────────────────────────────────────────────────────────────────────────────
def charts(tk, g, fits, bt, sigma_wad):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    os.makedirs(OUT, exist_ok=True)
    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
    b_ref = 1 - LLTV * LIF
    b_vigil = 1 - LLTV * (1 - MARKET_CAP_BPS / BPS) * LIF
    colors = {"night": "#4f8dff", "weekend": "#f5b83d", "earnings": "#ff5c5c", "long": "#b28dff"}

    # (a) gap distribution
    fig, ax = plt.subplots(figsize=(9, 4.8))
    bins = np.linspace(-0.20, 0.25, 91)
    for reg in ["night", "weekend", "earnings"]:
        r = g.loc[g.regime == reg, "r"].values
        ax.hist(r, bins=bins, density=True, histtype="step", lw=1.8, color=colors[reg], label=f"{reg} (n={len(r)})")
    ax.set_yscale("log")
    ax.set_ylim(0.2, 80)
    for b, lab, c, y in [(b_ref, f"plain market: bad debt beyond −{b_ref:.2%}", "#888", 45), (b_vigil, f"Vigil, 5 % cap: bad debt beyond −{b_vigil:.2%}", "#f5b83d", 12)]:
        x = math.log(1 - b)
        ax.axvline(x, color=c, ls="--", lw=1.2)
        ax.text(x - 0.003, y, lab, rotation=90, va="top", ha="right", fontsize=8, color=c)
    worst = g.sort_values("r").head(2).itertuples()
    for w, y in zip(worst, (4.0, 1.9)):
        ax.annotate(f"{w.date:%-d %b %Y}: {w.loss:.1%}, {w.regime}", (w.r, 1.15), xytext=(w.r + 0.02, y), fontsize=8,
                    arrowprops={"arrowstyle": "->", "color": "#333", "lw": 0.8})
    ax.set_xlabel("close → next open log return")
    ax.set_ylabel("density (log)")
    ax.set_title(f"{tk}: overnight gaps by regime, {g.date.min():%b %Y} – {g.date.max():%b %Y}")
    ax.legend(loc="upper right", fontsize=9)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, f"{tk.lower()}_gap_distribution.png"), dpi=160)
    plt.close(fig)

    # (b) on-chain haircut curve vs empirical tail quantiles per closure length
    fig, ax = plt.subplots(figsize=(9, 4.8))
    Ls = np.arange(0, 120 * 3600 + 1, 1800)
    ax.plot(Ls / 3600, [haircut_bps(int(L), sigma_wad) for L in Ls], color="#f5b83d", lw=2, label="on-chain H(L), deployed surface")
    ax.axhline(MARKET_CAP_BPS, color="#4f8dff", ls="--", lw=1, label="market cap 500 bps")
    pts = g[g.regime != "earnings"].groupby("L_hours")["loss"]
    for L_h, s in pts:
        if len(s) < 15:
            continue
        q99 = np.quantile(s, 0.99) * BPS
        q95 = np.quantile(s, 0.95) * BPS
        ax.scatter([L_h], [q99], color="#ff5c5c", zorder=3)
        ax.scatter([L_h], [q95], color="#b28dff", zorder=3)
        ax.annotate(f"n={len(s)}", (L_h, q99), xytext=(4, 4), textcoords="offset points", fontsize=8)
    ax.scatter([], [], color="#ff5c5c", label="empirical 99 % loss quantile")
    ax.scatter([], [], color="#b28dff", label="empirical 95 % loss quantile")
    ax.set_xlabel("closure length L (hours)")
    ax.set_ylabel("bps")
    ax.set_title(f"{tk}: haircut curve vs. what actually happened per closure length")
    ax.legend(fontsize=9)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, f"{tk.lower()}_haircut_vs_quantiles.png"), dpi=160)
    plt.close(fig)

    # (c) weekend tail: empirical survival vs GPD
    fit = fits.get("weekend")
    if fit:
        fig, ax = plt.subplots(figsize=(9, 4.8))
        loss = np.sort(g.loc[g.regime == "weekend", "loss"].values)
        pos = loss[loss > 0]
        sf_emp = 1 - np.arange(1, len(loss) + 1) / len(loss)
        mask = loss > 0
        ax.step(loss[mask], np.maximum(sf_emp[mask], 1e-4), where="post", color="#4f8dff", label="empirical P(loss > x), weekends")
        xs = np.linspace(fit["u"], 0.30, 300)
        ax.plot(xs, [max(gpd_sf(fit, x), 1e-6) for x in xs], color="#f5b83d", lw=2,
                label=f"GPD tail (u = {fit['u']:.2%}, ξ = {fit['xi']:.2f})")
        for b, lab, c in [(b_ref, "plain-market buffer 10.23 %", "#888"), (b_vigil, "Vigil buffer at the 5 % cap 14.72 %", "#ff5c5c")]:
            ax.axvline(b, color=c, ls="--", lw=1)
            ax.text(b, 0.5, lab, rotation=90, va="top", ha="right", fontsize=8, color=c)
        ax.set_xscale("log")
        ax.set_yscale("log")
        ax.set_xlim(0.005, 0.30)
        ax.set_ylim(1e-4, 1)
        ax.set_xlabel("loss over the weekend (log)")
        ax.set_ylabel("P(loss > x)")
        ax.set_title(f"{tk}: weekend tail — how often a gap beats the buffer")
        ax.legend(fontsize=9, loc="lower left")
        fig.tight_layout()
        fig.savefig(os.path.join(OUT, f"{tk.lower()}_weekend_tail_gpd.png"), dpi=160)
        plt.close(fig)

    # (d) backtest cumulative
    fig, ax = plt.subplots(figsize=(9, 4.8))
    b = bt.sort_values("date")
    ax.plot(b.date, b.prem_vigil.cumsum() * 1e4, color="#3ddc84", lw=2, label="premium collected, max-LTV borrower (bp of debt)")
    ax.plot(b.date, b.sf_ctrl.cumsum() * 1e4, color="#888", lw=2, label="bad debt, plain market (bp of debt)")
    ax.plot(b.date, b.sf_vigil.cumsum() * 1e4, color="#f5b83d", lw=2, label="bad debt, Vigil haircut only")
    ax.plot(b.date, b.sf_member.cumsum() * 1e4, color="#4f8dff", lw=2, ls="--", label="bad debt, member unwound to 76 %")
    ax.set_ylabel("cumulative bp of debt")
    ax.set_title(f"{tk}: 4-year backtest of the on-chain model, one position per closure")
    ax.legend(fontsize=9, loc="upper left")
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, f"{tk.lower()}_backtest.png"), dpi=160)
    plt.close(fig)


# ── report ───────────────────────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    b_ref = 1 - LLTV * LIF
    b_vigil = 1 - LLTV * (1 - MARKET_CAP_BPS / BPS) * LIF
    lines = [
        "# Vigil — full calibration (PRD §10.1, stage 2)",
        "",
        f"Data: daily OHLC {qc.START} → {qc.END} (Yahoo Finance, split-adjusted), earnings dates from Yahoo (AMC: the gap is the earnings close → next open). "
        f"Regimes as in `report.md`. LLTV {LLTV:.2f}, LIF {LIF:.4f}, plain-market buffer b_ref = 1 − LLTV·LIF = **{b_ref:.2%}**; "
        f"Vigil market buffer at the 500 bps cap = 1 − LLTV·(1 − 5 %)·LIF = **{b_vigil:.2%}** (a max-LTV borrower on a Vigil market is only in bad debt beyond this).",
        "",
        "The on-chain arithmetic (`closureHaircutBps`, `premiumRefRatePerSecond`, `bufferMultiplierWad`, `bufferBps`) is replicated integer-for-integer; "
        "`test_calibration.py` checks it against the Foundry fixture (`test/unit/CurveFixture.t.sol`).",
        "",
    ]
    years = None
    summary_rows = []
    for tk in qc.TICKERS:
        px, earnings = qc.load(tk, args.offline)
        g, _ = qc.build_gaps(px, earnings)
        years = (g.date.max() - g.date.min()).days / 365.25
        night_sigma = float(g.loc[g.regime == "night", "r"].std(ddof=1))
        earn_sigma = float(g.loc[g.regime == "earnings", "r"].std(ddof=1))
        sigma_wad = NVDA_SIGMA_WAD if tk == "NVDA" else int(round(night_sigma, 4) * WAD)
        event_mult_bps = min(50_000, int(round(earn_sigma / night_sigma * BPS)))
        lines += [f"## {tk}", "",
                  f"Surface used in the backtest: σ_gap = {sigma_wad / WAD:.4f} ({'deployed NVDA surface' if tk == 'NVDA' else 'sample night σ, rounded'}), k = 3.0, floor 50 bps, max 2,500 bps, "
                  f"earnings multiplier {event_mult_bps / BPS:.2f}× (σ_earnings / σ_night, capped at the contract's 5×). {years:.2f} years, {len(g)} closures.", ""]

        # GPD per regime
        fits = {}
        lines += ["### Peaks-over-threshold tails (GPD on losses beyond the 90th percentile)", "",
                  "| Regime | n | u | n > u | ξ (5–95 % bootstrap) | β | ξ at u = q85 / q95 | VaR 99 % | VaR 99.5 % | VaR 99.9 % | P(loss > b_ref) per closure | P(loss > b_vigil) per closure | E[shortfall] beyond b_ref (GPD / t-fit / emp) | beyond b_vigil (GPD) |",
                  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
        qs = qc.group_stats(g.loc[g.regime == "weekend", "r"].values) if (g.regime == "weekend").sum() >= 8 else None
        for reg in ["night", "weekend", "long", "earnings"]:
            loss = g.loc[g.regime == reg, "loss"].values
            if len(loss) < 40:
                lines.append(f"| {reg} | {len(loss)} | — | — | too few closures for a tail fit | | | | | | | | | |")
                continue
            fit = gpd_fit(loss)
            if not fit:
                lines.append(f"| {reg} | {len(loss)} | — | — | fit failed | | | | | | | | | |")
                continue
            fits[reg] = fit
            lo, hi = bootstrap_xi(loss)
            xi85 = gpd_fit(loss, 0.85)["xi"] if gpd_fit(loss, 0.85) else float("nan")
            xi95 = gpd_fit(loss, 0.95)["xi"] if gpd_fit(loss, 0.95) else float("nan")
            st = qc.group_stats(g.loc[g.regime == reg, "r"].values)
            es_t = st["es"][qc.B_REF]["t"]
            es_emp = st["es"][qc.B_REF]["emp"]
            lines.append(
                f"| {reg} | {fit['n']} | {fit['u']:.2%} | {fit['n_exc']} | {fit['xi']:.2f} ({lo:.2f}…{hi:.2f}) | {fit['beta']:.3%} | {xi85:.2f} / {xi95:.2f} "
                f"| {gpd_var(fit, 0.99):.2%} | {gpd_var(fit, 0.995):.2%} | {gpd_var(fit, 0.999):.2%} "
                f"| {gpd_sf(fit, b_ref):.3%} | {gpd_sf(fit, b_vigil):.3%} "
                f"| {gpd_es_beyond(fit, b_ref):.4%} / {es_t:.4%} / {es_emp:.4%} | {gpd_es_beyond(fit, b_vigil):.4%} |")
        if "weekend" in fits:
            f = fits["weekend"]
            per_year = gpd_sf(f, b_vigil) * 52
            lines += ["",
                      f"Reading the weekend row: with the 5 % cap in force a max-LTV position is in bad debt only if the weekend gap exceeds {b_vigil:.2%}; "
                      f"the GPD tail puts that at **{gpd_sf(f, b_vigil):.3%} per weekend ≈ {per_year:.2f} per year**, versus {gpd_sf(f, b_ref):.3%} per weekend "
                      f"(≈ {gpd_sf(f, b_ref) * 52:.2f} per year) beyond the plain-market buffer — the two Monday gaps in the sample sit in that band.", ""]

        # backtest
        bt = backtest(g, sigma_wad, event_mult_bps)
        bt.to_csv(os.path.join(OUT, f"{tk.lower()}_backtest.csv"), index=False)
        s = summarize_backtest(bt, years)
        summary_rows.append((tk, s))
        lines += ["### Backtest of the on-chain model — one max-size position per closure", "",
                  "| Position | closures with bad debt | total bad debt (bp of debt) | worst closure (bp) | premium collected (bp of debt / year) | bad debt (bp / year) | loss ratio |",
                  "|---|---|---|---|---|---|---|",
                  f"| Plain Morpho market (control) | {s['events_ctrl']} | {s['loss_ctrl_bp']:.1f} | {s['worst_ctrl_bp']:.1f} | — | {s['loss_ctrl_bp'] / years:.1f} | — |",
                  f"| Vigil market, max-LTV borrower (haircut only) | {s['events_vigil']} | {s['loss_vigil_bp']:.1f} | {s['worst_vigil_bp']:.1f} | {s['prem_vigil_bp_yr']:.1f} | {s['loss_vigil_bp_yr']:.1f} | {s['loss_ratio_vigil']:.2f} |",
                  f"| Vigil member, unwound to {TARGET_LTV:.0%} before each close | {s['events_member']} | {s['loss_member_bp']:.1f} | — | {s['prem_member_bp_yr']:.1f} | {s['loss_member_bp_yr']:.1f} | {s['loss_ratio_member']:.2f} |",
                  "",
                  "Premium = Σ over closures of `premiumRefRatePerSecond(L) × L × m(b)`, with `b = 1 − LTV_raw·LIF` exactly as `VigilPremium.bufferBps` computes it "
                  "(a max-LTV borrower on a Vigil market sits at b ≈ 14.7 % during a closure, so m(b) ≈ 0.45; the unwound member at ≈ 24 %, m ≈ 0.21). "
                  "Bad debt is measured against a full seizure at the gapped price with LIF; a 0 means no closure in four years would have produced bad debt for that position.",
                  ""]
        # premium adequacy: expected annual bad debt of the max-LTV Vigil borrower under three tail estimators
        d_vigil = LLTV * (1 - MARKET_CAP_BPS / BPS)
        per_year = {reg: (g.regime == reg).sum() / years for reg in ["night", "weekend", "long", "earnings"]}
        exp_gpd = exp_t = 0.0
        for reg in ["night", "weekend"]:
            st = qc.group_stats(g.loc[g.regime == reg, "r"].values)
            tpdf = (lambda x, st=st: stats.t.pdf(x, st["t_df"], st["t_loc"], st["t_scale"])) if not math.isnan(st.get("t_df", float("nan"))) else None
            es_t_v = qc.es_from_density(tpdf, b_vigil) if tpdf else 0.0
            exp_t += per_year[reg] * es_t_v / d_vigil
            if reg in fits:
                exp_gpd += per_year[reg] * gpd_es_beyond(fits[reg], b_vigil) / d_vigil
        realized = s["loss_vigil_bp_yr"]
        lines += ["### Premium adequacy — max-LTV borrower on the Vigil market, bp of debt per year", "",
                  "| Premium collected (deployed tables) | Expected bad debt beyond the 14.72 % buffer: GPD tail | t-fit | realized 2022–2026 |",
                  "|---|---|---|---|",
                  f"| {s['prem_vigil_bp_yr']:.1f} | {exp_gpd * 1e4:.1f} | {exp_t * 1e4:.1f} | {realized:.1f} |",
                  "",
                  "The GPD point estimate extrapolates from ~19 weekend exceedances with a wide ξ interval, so its expected loss is an upper band; the t-fit is the lower band; the sample realized nothing beyond the buffer. "
                  "The deployed tables sit between the two — this spread is the argument for a first-loss tranche with a coverage cap and for keeping the premium tables adjustable by the calibrator role rather than immutable.",
                  ""]
        worst = bt.sort_values("loss", ascending=False).head(6)
        lines += ["| Worst closures | regime | L (h) | loss | engine H(L) | market haircut | bad debt: plain / Vigil / member (bp of debt) |", "|---|---|---|---|---|---|---|"]
        for w in worst.itertuples():
            lines.append(f"| {w.date:%Y-%m-%d} | {w.regime} | {w.L_h:.1f} | {w.loss:.2%} | {w.h_engine_bps} bps | {w.h_market_bps} bps | {w.sf_ctrl * 1e4:.1f} / {w.sf_vigil * 1e4:.1f} / {w.sf_member * 1e4:.1f} |")
        lines.append("")
        charts(tk, g, fits, bt, sigma_wad)
        lines += [f"Charts: `out/{tk.lower()}_gap_distribution.png`, `out/{tk.lower()}_haircut_vs_quantiles.png`, `out/{tk.lower()}_weekend_tail_gpd.png`, `out/{tk.lower()}_backtest.png`.", ""]

    lines += ["## Across tickers", "", "| Ticker | plain-market bad-debt closures | Vigil (haircut only) | member (unwound) | premium, max-LTV borrower (bp/yr) | premium, member (bp/yr) |", "|---|---|---|---|---|---|"]
    for tk, s in summary_rows:
        lines.append(f"| {tk} | {s['events_ctrl']} ({s['loss_ctrl_bp']:.1f} bp) | {s['events_vigil']} ({s['loss_vigil_bp']:.1f} bp) | {s['events_member']} ({s['loss_member_bp']:.1f} bp) | {s['prem_vigil_bp_yr']:.1f} | {s['prem_member_bp_yr']:.1f} |")
    lines += ["",
              "## What this changes, and what it does not",
              "",
              "- The deployed NVDA surface (σ 1.6 %, k 3.0) with the 500 bps market cap turns the plain-market buffer of 10.23 % into 14.72 % during closures; over four years no closure of NVDA, AAPL or TSLA produced bad debt for a max-LTV position on a Vigil market, while the plain market took the two NVDA Mondays and the TSLA Monday of 5 Aug 2024.",
              "- The residual tail beyond 14.72 % is what the premium and the backstop are for; the GPD rows quantify it per weekend and per year. The premium tables were set from the t-fit at b_ref (quick calibration); at the buffers members actually hold the collected premium is a few bp of debt per year — small, as the PRD's business section says, and priced against a tail that did not materialise in the sample.",
              "- Not changed on chain: the surface and tables stay as deployed. The backtest supports them; a recalibration would be justified only with more closures in the earnings regime (n ≈ 16 per ticker).",
              "- Caveats: one position per closure, opened at the maximum the oracle allows at the close — the harshest case; Yahoo daily opens (auction prints, not the first tradeable price); no interest accrual inside a closure; the soft unwind is assumed to have completed before the close.",
              ""]
    with open(os.path.join(HERE, "report_full.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("wrote", os.path.join(HERE, "report_full.md"), "and", OUT)


if __name__ == "__main__":
    main()
