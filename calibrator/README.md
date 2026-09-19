# Calibrator

Everything the pitch numbers come from, reproducible from the cached data.

| File | What |
|---|---|
| `quick_calibration.py` → `report.md` | stage 1: gap distributions per regime (night / weekend / long / earnings), Student-t expected shortfall, the `π_ref` × `m(b)` tables used by `script/DeployLib.sol` |
| `full_calibration.py` → `report_full.md`, `out/*.png` | stage 2: peaks-over-threshold (GPD) tails with bootstrap intervals, a backtest of the *on-chain* model over every closure of 2022-09 → 2026-09 for NVDA / AAPL / TSLA, premium adequacy, charts |
| `test_calibration.py` | the Python replicas of `closureHaircutBps`, `premiumRefRatePerSecond`, `bufferMultiplierWad` and `bufferBps` reproduce the Foundry fixture (`test/unit/CurveFixture.t.sol`) integer for integer |
| `data/` | daily OHLC and earnings dates (Yahoo Finance, split-adjusted), cached so `--offline` needs no network |

```bash
pip install -r calibrator/requirements.txt
python -m unittest -q calibrator/test_calibration.py           # parity with the contracts
python calibrator/quick_calibration.py --offline                 # → report.md
python calibrator/full_calibration.py --offline                  # → report_full.md, out/*.png (~35 s)
```

Drop `--offline` to refresh the data through `yfinance`.
