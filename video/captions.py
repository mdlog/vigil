#!/usr/bin/env python3
"""Cuts the continuous take into beats, computes each beat's hold, and writes
the burned-in captions (ASS), the upload SRT and out/cut.json for build.py.

A beat starts at its mark in the take and ends at the next beat's mark; if the
narration (delay + speech + gap) is longer than that footage, build.py holds
the beat's last frame for the difference. The last beat runs to the end of the take."""
import json
import pathlib
import re
import subprocess

VIDEO = pathlib.Path(__file__).resolve().parent
OUT = VIDEO / "out"
PUBLIC_HOST = "mdlog.github.io/vigil"
GAP_S = 0.4


def _norm(t):
    return "".join(ch for ch in t.lower() if ch.isalnum())


def attach_punctuation(words, text):
    """edge-tts word boundaries carry no punctuation; take each spoken word's
    spelling from the narration text so cues can end where sentences end."""
    toks = []
    for t in text.split():
        if _norm(t):
            toks.append(t)
        elif toks:
            toks[-1] += " " + t
    out, j, remainder = [], 0, ""
    for w in words:
        nw = _norm(w["text"])
        if remainder and remainder.startswith(nw):
            remainder = remainder[len(nw):]
            out[-1]["end"] = w["end"]
            continue
        remainder = ""
        k = next((j + d for d in range(4) if j + d < len(toks) and (_norm(toks[j + d]) == nw or _norm(toks[j + d]).startswith(nw))), None)
        if k is None:
            out.append(dict(w))
            continue
        out.append({**w, "text": toks[k]})
        remainder = _norm(toks[k])[len(nw):]
        j = k + 1
    return out


def _flush(lines, start, end, out):
    if lines:
        out.append({"start": start, "end": end, "text": "\\N".join(lines)})


def cues(words, offset_s, delay_s, max_chars=42, max_lines=2, min_s=1.2):
    out, lines, cur, start, prev_end = [], [], "", None, 0.0
    for w in words:
        t = w["text"]
        if start is None:
            start = offset_s + delay_s + w["start"]
        if cur and len(cur) + 1 + len(t) > max_chars:
            lines.append(cur)
            cur = ""
            if len(lines) == max_lines:
                _flush(lines, start, offset_s + delay_s + prev_end, out)
                lines, start = [], offset_s + delay_s + w["start"]
        cur = (cur + " " + t).strip()
        prev_end = w["end"]
        if t.endswith((".", "?", "!")):
            lines.append(cur)
            cur = ""
            _flush(lines, start, offset_s + delay_s + prev_end, out)
            lines, start = [], None
    if cur:
        lines.append(cur)
    if lines:
        _flush(lines, start, offset_s + delay_s + prev_end, out)
    for i, c in enumerate(out):
        want = c["start"] + min_s
        nxt = out[i + 1]["start"] if i + 1 < len(out) else float("inf")
        c["end"] = max(c["end"], min(want, nxt))
    return out


def ass_time(s):
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{int(h)}:{int(m):02d}:{sec:05.2f}"


def srt_time(s):
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(sec):02d},{int(round((sec - int(sec)) * 1000)):03d}"


HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Inter,40,&H00F0EBE8,&H00FFFFFF,&H00000000,&H8C000000,0,0,0,0,100,100,0,0,3,0,0,2,200,200,64,1
Style: Chip,DejaVu Sans Mono,24,&H00F0EBE8,&H00FFFFFF,&H00000000,&HA0000000,0,0,0,0,100,100,0,0,3,0,0,3,0,28,22,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def plan_cuts(audio, beats, marks, end_s, gap_s=GAP_S, end_card_s=5.0):
    """One entry per beat: the footage ranges kept from the take, the hold, the
    narration delay, and where the beat lands in the output."""
    ids = [a["id"] for a in audio]
    meta = {b["id"]: b for b in beats}
    cut, t = [], 0.0
    for i, row in enumerate(audio):
        b = row["id"]
        start = marks[b]
        end = marks[ids[i + 1]] if i + 1 < len(ids) else end_s
        m = meta[b]
        ranges = [[start, end]]
        skip = m.get("skipIdle")
        if skip and end - start > skip["headS"] + skip["tailS"]:
            ranges = [[start, start + skip["headS"]], [end - skip["tailS"], end]]
        available = sum(e - s for s, e in ranges)
        delay = row["delayMs"] / 1000
        if m.get("endBeforeCard") and "end" in marks:
            card_at = marks["end"] - start  # end card position within this beat's footage
            delay = max(delay, card_at - 1.0 - row["audioS"])
        needed = delay + row["audioS"] + gap_s
        segment = max(available, needed)
        cut.append({"id": b, "ranges": [[round(s, 3), round(e, 3)] for s, e in ranges], "availableS": round(available, 3),
                    "holdS": round(segment - available, 3), "segmentS": round(segment, 3), "outStartS": round(t, 3),
                    "delayS": round(delay, 3)})
        t += segment
    return cut


def out_time(cut, raw_s):
    """Output time of a moment in the take, or None if it was cut away."""
    for c in cut:
        offset = 0.0
        for s, e in c["ranges"]:
            if s <= raw_s <= e:
                return c["outStartS"] + offset + (raw_s - s)
            offset += e - s
    return None


def main():
    audio = json.loads((OUT / "audio" / "index.json").read_text())
    timeline = json.loads((OUT / "timeline.json").read_text())
    node = lambda flag: json.loads(subprocess.check_output(["node", "--experimental-strip-types", str(VIDEO / "script.ts"), flag], text=True, stderr=subprocess.DEVNULL))
    narration = {n["id"]: n["text"] for n in node("--narration")}
    beats = node("--beats")
    marks = {m["id"]: m["atS"] for m in timeline["marks"]}
    for row in audio:
        if row["id"] not in marks:
            raise SystemExit(f"beat {row['id']} has no mark in the take — its phase never confirmed on camera")
    cut = plan_cuts(audio, beats, marks, float(timeline["durationS"]))
    events, srt = [], []
    for row, c in zip(audio, cut):
        words = attach_punctuation(json.loads((OUT / "audio" / row["words"]).read_text()), narration[row["id"]])
        for cue in cues(words, c["outStartS"], c["delayS"]):
            events.append(f"Dialogue: 0,{ass_time(cue['start'])},{ass_time(cue['end'])},Cap,,0,0,0,,{cue['text']}")
            srt.append((cue["start"], cue["end"], cue["text"].replace("\\N", "\n")))
    total = cut[-1]["outStartS"] + cut[-1]["segmentS"]
    chip_start = out_time(cut, marks["00-title"] + 5.0)
    expl = marks.get("explorer")
    end_card = marks.get("end", float(timeline["durationS"]))
    chip_end = out_time(cut, expl if expl is not None else end_card)
    if chip_start is not None and chip_end is not None:
        events.append(f"Dialogue: 1,{ass_time(chip_start)},{ass_time(chip_end)},Chip,,0,0,0,,{PUBLIC_HOST} · Robinhood Chain testnet 46630")
    if expl is not None and timeline.get("coverTx"):
        tx = timeline["coverTx"]
        a, b = out_time(cut, expl), out_time(cut, end_card)
        if a is not None and b is not None:
            events.append(f"Dialogue: 1,{ass_time(a)},{ass_time(b)},Chip,,0,0,0,,explorer.testnet.chain.robinhood.com/tx/{tx[:10]}…{tx[-4:]}")
    (OUT / "captions.ass").write_text(HEADER + "\n".join(events) + "\n")
    (OUT / "captions.srt").write_text("".join(f"{i}\n{srt_time(a)} --> {srt_time(b)}\n{txt}\n\n" for i, (a, b, txt) in enumerate(srt, 1)))
    (OUT / "cut.json").write_text(json.dumps(cut, indent=1))
    for c in cut:
        print(f"  {c['id']:<20} footage {c['availableS']:6.1f}s  hold {c['holdS']:5.1f}s  delay {c['delayS']:5.1f}s  → {c['segmentS']:6.1f}s  ranges {c['ranges']}")
    print(f"{len(srt)} cues, total {total:.1f}s -> captions.ass / captions.srt / cut.json")


if __name__ == "__main__":
    main()
