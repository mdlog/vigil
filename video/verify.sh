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
    (f"falls to {fmt(t['priceAfter'])}" in n["04-gap-liquidate"], "price after gap"),
    (f"{t['txCount']} transactions" in n["05-restore-end"], "tx count"),
    (f"{fmt(t['backstopAfterUsdg'])} USDG" in n["05-restore-end"], "backstop after"),
    (t["bobCoveredUsdg"] == 0 and t["suppliersAfter"] >= t["suppliersBefore"], "claims"),
]
for ok, what in checks:
    print("   ", "ok " if ok else "MISMATCH", what)
sys.exit(0 if all(ok for ok, _ in checks) else 1)
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
