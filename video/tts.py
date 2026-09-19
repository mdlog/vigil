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
LIMIT_S = 172.0
CUT_LIST = [
    'Beat 01: drop "Watch the market line: borrowed and supplied move as the transactions confirm."',
    'Beat 03: drop "A keeper can only tighten, and the attestation expires in thirty minutes."',
    'Beat 00: drop "It funds five throwaway actors first."',
]


def narration():
    raw = subprocess.check_output(
        ["node", "--experimental-strip-types", str(VIDEO / "script.ts"), "--narration"],
        text=True, stderr=subprocess.DEVNULL,
    )
    return json.loads(raw)


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
        total = sum(b["audioS"] + b["delayMs"] / 1000 + GAP_S for b in index)
        print(f"speech total {total:.1f}s (limit {LIMIT_S:.0f}s; the take adds its own footage)")
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
