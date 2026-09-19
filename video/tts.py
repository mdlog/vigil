#!/usr/bin/env python3
"""Narration via edge-tts, one file per beat, with word boundaries for captions.
Copied from the reference pipeline; the cut list is Vigil's."""
import asyncio
import json
import pathlib
import subprocess
import sys

VIDEO = pathlib.Path(__file__).resolve().parent
OUT = VIDEO / "out" / "audio"
VOICE = "en-US-AndrewNeural"
GAP_S = 0.4
LIMIT_S = 179.5  # projected length of the whole cut (build.py refuses > 180 s)
# Never the take's narration first: it is the honesty spine (README › Honesty rules).
CUT_LIST = [
    'post-02-backtest: drop "— for a premium of one hundred twenty-two basis points a year."',
    'pre-02-gaps: drop "— and utilization-based interest charged nothing for either."',
    'post-01-fork: drop "the same contracts"',
    'Beat 01: drop "Watch the market line: borrowed and supplied move as the transactions confirm."',
    'Beat 00: drop "It funds five throwaway actors first."',
]


def node(flag):
    raw = subprocess.check_output(
        ["node", "--experimental-strip-types", str(VIDEO / "script.ts"), flag],
        text=True, stderr=subprocess.DEVNULL,
    )
    return json.loads(raw)


def narration():
    return node("--narration")


def projected_length(index):
    """Length of the finished cut for this narration: the take's footage floors plus the card beats.
    Needs out/timeline.json (the take is recorded before the narration is rendered)."""
    from captions import plan_cuts

    timeline = json.loads((VIDEO / "out" / "timeline.json").read_text())
    marks = {m["id"]: m["atS"] for m in timeline["marks"]}
    cards = {c["id"]: c for c in node("--cards")}
    cut = plan_cuts(index, node("--beats"), marks, float(timeline["durationS"]), cards)
    return sum(c["segmentS"] for c in cut)


def duration_s(mp3: pathlib.Path) -> float:
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp3)], text=True
    )
    return float(out.strip())


async def synth(text: str, mp3: pathlib.Path, rate: str):
    import edge_tts

    words = []
    com = edge_tts.Communicate(text, VOICE, rate=rate, boundary="WordBoundary")
    with mp3.open("wb") as f:
        async for chunk in com.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                words.append({
                    "start": chunk["offset"] / 1e7,
                    "end": (chunk["offset"] + chunk["duration"]) / 1e7,
                    "text": chunk["text"],
                })
    return words


async def render(rate: str):
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for beat in narration():
        base = beat["id"]
        mp3 = OUT / f"{base}.mp3"
        for attempt in range(3):
            try:
                words = await synth(beat["text"], mp3, rate)
                break
            except Exception as e:  # network hiccup: retry, then give up loudly
                if attempt == 2:
                    raise
                print(f"  {base}: {e!r}; retrying", file=sys.stderr)
                await asyncio.sleep(2 * (attempt + 1))
        if not words:
            raise SystemExit(f"{base}: edge-tts returned no word boundaries (pass boundary='WordBoundary')")
        (OUT / f"{base}.words.json").write_text(json.dumps(words, indent=1))
        audio_s = duration_s(mp3)
        index.append({"id": base, "mp3": mp3.name, "words": f"{base}.words.json", "delayMs": beat["delayMs"],
                      "audioS": round(audio_s, 3), "rate": rate})
        print(f"  {base}: {audio_s:6.2f}s speech ({len(words)} words)")
    return index


def main():
    rate = "+0%"
    while True:
        print(f"rendering at rate {rate}")
        index = asyncio.run(render(rate))
        speech = sum(b["audioS"] + b["delayMs"] / 1000 + GAP_S for b in index)
        total = projected_length(index)
        print(f"speech total {speech:.1f}s → projected cut {total:.1f}s (limit {LIMIT_S:.1f}s)")
        if total <= LIMIT_S:
            break
        if rate == "+0%":
            rate = "+6%"
            continue
        print("still over after +6%. Apply the cut list, in order, in video/script.ts:")
        for c in CUT_LIST:
            print("  -", c)
        sys.exit(2)
    (OUT / "index.json").write_text(json.dumps(index, indent=1))
    print("wrote", OUT / "index.json")


if __name__ == "__main__":
    main()
