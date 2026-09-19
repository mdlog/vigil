#!/usr/bin/env python3
"""Writes out/youtube.md — title, description and chapters — from the take
(out/take.json) and the cut (out/cut.json), so the upload text carries the
same numbers and timings as the video."""
import json
import pathlib

VIDEO = pathlib.Path(__file__).resolve().parent
OUT = VIDEO / "out"

CHAPTERS = {
    "pre-01-problem": "The problem: a 24/7 chain on a 24/5 feed",
    "pre-02-gaps": "Four years of NVDA overnight gaps",
    "00-title": "Saturday on Robinhood Chain testnet: regime CLOSED, feed {feedBefore}, Vigil {priceBefore}",
    "01-supply-borrow": "Supply and borrow at the haircut price",
    "02-member-backstop": "Membership and the first-loss backstop",
    "03-keeper-unwind": "Keeper attestation and soft unwind",
    "04-gap-liquidate": "The Monday gap and liquidateWithCover",
    "05-restore-end": "Results and the explorer",
    "post-01-fork": "Mainnet fork: real Morpho, USDG, NVDA, feed",
    "post-02-backtest": "Backtest: three tickers, four years",
    "post-03-end": "Links",
}


def mmss(s: float) -> str:
    s = int(s)
    return f"{s // 60}:{s % 60:02d}"


def main():
    t = json.loads((OUT / "take.json").read_text())
    cut = json.loads((OUT / "cut.json").read_text())
    fmt = lambda v, d=2: f"{v:,.{d}f}"
    chapters = "\n".join(
        f"{mmss(c['outStartS'])} {CHAPTERS[c['id']].format(feedBefore=fmt(t['feedBefore'], 0), priceBefore=fmt(t['priceBefore'], 0))}"
        for c in cut
    )
    md = f"""# YouTube

**Title (≤ 80 chars):** Vigil — a weekend gap replayed live on Robinhood Chain testnet

**Description:**
Vigil is a session-aware collateral risk layer for tokenized equity on Morpho Blue. The middle of this video is a real end-to-end run against the deployed contracts on Robinhood Chain testnet (chain {t['chainId']}), recorded from the public dashboard: five throwaway actors supply, borrow, join, fund the backstop, the keeper tightens the session, one member is unwound before the gap, the feed replays the NVDA gap of 5 August 2024 (−{t['dropBps'] / 100:.2f} %), and both members are liquidated with the backstop covering the shortfall ({fmt(t['erinCoveredUsdg'])} USDG). {t['txCount']} transactions, blocks {t['firstBlock']}–{t['lastBlock']}; every number in that part was read from the chain during the take. Around it: the four-year NVDA gap distribution, the mainnet-fork result against the real Morpho, USDG, NVDA token and Chainlink feed, and the backtest across NVDA, AAPL and TSLA (calibrator/report_full.md in the repo).

Dashboard: {t['dashboard'].split('?')[0]}
Code: https://github.com/mdlog/vigil
Cover transaction: {t['explorer']}/tx/{t['coverTx']}

USDG, NVDA and the price feed are mocks on the testnet.

**Chapters:**
{chapters}
"""
    (OUT / "youtube.md").write_text(md)
    print(md)


if __name__ == "__main__":
    main()
