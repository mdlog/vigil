#!/usr/bin/env bash
# Checks before the MP4 leaves the machine. Exit non-zero on the first failure.
set -euo pipefail
cd "$(dirname "$0")"
MP4=out/vigil-e2e.mp4
echo "1. streams + duration"
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,r_frame_rate:format=duration -of csv=p=0 "$MP4"
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$MP4")
python3 -c "import sys; d=float('$dur'); print(f'   {d:.1f}s'); sys.exit(0 if d <= 180 else 1)"
echo "2. caption cue counts (ass == srt)"
python3 - <<'PY'
import sys
a = open("out/captions.ass").read().count(",Cap,")
b = open("out/vigil-e2e.srt").read().count("-->")
print(f"   ass={a} srt={b}"); sys.exit(0 if a == b and a > 0 else 1)
PY
echo "3. narrated numbers match the take"
python3 - <<'PY'
import json, subprocess, sys
t = json.load(open("out/take.json"))
n = {x["id"]: x["text"] for x in json.loads(subprocess.check_output(["node", "--experimental-strip-types", "script.ts", "--narration"], text=True, stderr=subprocess.DEVNULL))}
fmt = lambda v, d=2: f"{v:,.{d}f}"
checks = [
    (f"{fmt(t['erinShortfallUsdg'])} USDG" in n["04-gap-liquidate"], "shortfall"),
    (f"post {fmt(t['collateralNvda'])} {t['symbol']}" in n["01-supply-borrow"], "collateral"),
    (f"falls to {fmt(t['priceAfter'])}" in n["04-gap-liquidate"], "price after gap"),
    (f"{t['txCount']} transactions" in n["05-restore-end"], "tx count"),
    (f"{fmt(t['backstopAfterUsdg'])} USDG" in n["05-restore-end"], "backstop after"),
    (t["bobCoveredUsdg"] == 0 and t["suppliersAfter"] >= t["suppliersBefore"], "claims"),
]
for ok, what in checks:
    print("   ", "ok " if ok else "MISMATCH", what)
sys.exit(0 if all(ok for ok, _ in checks) else 1)
PY
echo "3b. every number on a card or in the card narration exists in its source file"
python3 - <<'PY'
import json, re, subprocess, sys
cards = open("cards.html").read()
n = {x["id"]: x["text"] for x in json.loads(subprocess.check_output(["node", "--experimental-strip-types", "script.ts", "--narration"], text=True, stderr=subprocess.DEVNULL))}
report = open("../calibrator/report_full.md").read()
readme = open("../README.md").read()
checks = [
    ("4.04 years, 1014 closures" in report and "4.04 YEARS" in cards.upper() and "1,014" in cards, "years / closures"),
    ("14.18%" in report and "−14.18 %" in cards, "gap 5 Aug 2024"),
    ("12.49%" in report and "−12.49 %" in cards, "gap 27 Jan 2025"),
    ("LLTV 0.86" in report and "86 %" in cards and "eighty-six percent" in n["pre-02-gaps"], "LLTV 86 %"),
    (re.search(r"NVDA \| 2 \(.*\n\| AAPL \| 0 \(.*\n\| TSLA \| 1 \(", report) is not None and "3 bad-debt closures" in cards and "three bad-debt closures" in n["post-02-backtest"], "3 plain-market closures"),
    ("| 122.2 | 299.2 | 17.8 | 0.0 |" in report and "122 bp/yr" in cards and "18 – 299 bp/yr" in cards and "one hundred twenty-two basis points" in n["post-02-backtest"], "premium vs tail"),
    ("31.20 USDG shortfall" in readme and "31.20 USDG" in cards, "fork cover"),
    ("500 bps at +10 min, 244 bps at +45 min" in readme and "500 → 244 bps" in cards, "fork ramp-out"),
    ("Friday 15:55" in readme and "Fri 15:55 ET" in cards, "feed frozen since Friday"),
    ("all 50 closures + 11 early closes match" in readme and "50/50 closures, 11/11 early closes" in cards, "calendar V15"),
    ("run 24/5 and **freeze for the whole" in readme and "twenty-four five" in n["pre-01-problem"], "24/5 feed"),
    ("charged nothing for either" in readme and "charged nothing for either" in n["pre-02-gaps"], "interest charged nothing"),
]
for ok, what in checks:
    print("   ", "ok " if ok else "MISMATCH", what)
sys.exit(0 if all(ok for ok, _ in checks) else 1)
PY
echo "3c. every card beat has a 1920x1080 screenshot"
python3 - <<'PY'
import json, struct, subprocess, sys
cards = json.loads(subprocess.check_output(["node", "--experimental-strip-types", "script.ts", "--cards"], text=True, stderr=subprocess.DEVNULL))
bad = []
for c in cards:
    try:
        d = open(f"out/cards/{c['card']}.png", "rb").read(24)
        w, h = struct.unpack(">II", d[16:24])
        if (w, h) != (1920, 1080): bad.append(f"{c['card']} is {w}x{h}")
    except FileNotFoundError:
        bad.append(f"{c['card']} missing")
print("   ", f"{len(cards)} cards", "ok" if not bad else bad); sys.exit(1 if bad else 0)
PY
echo "4. every confirmation on camera is a successful receipt"
python3 - <<'PY'
import json, sys
tl = json.load(open("out/timeline.json"))
bc = json.load(open("../broadcast/E2E.s.sol/46630/run-latest.json"))
ok = {r["transactionHash"] for r in bc["receipts"] if r["status"] == "0x1"}
missing = [h for h in tl["hashes"] if h not in ok]
print(f"   {len(tl['hashes'])} on camera, {len(ok)} successful receipts, missing {len(missing)}"); sys.exit(0 if not missing and len(tl["hashes"]) == 37 else 1)
PY
echo "5. nothing large staged"
git -C .. status --short | grep -E "\.(mp4|webm|mp3|png)$" && { echo "   media staged!"; exit 1; } || echo "   ok"
echo "all checks passed"
