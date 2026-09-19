#!/usr/bin/env python3
"""Cuts the take per out/cut.json, holds the last frame where the narration is
longer than the footage, muxes the narration, concatenates, burns the captions
and refuses to emit anything over 3:00."""
import json
import pathlib
import shutil
import subprocess
import sys

VIDEO = pathlib.Path(__file__).resolve().parent
OUT = VIDEO / "out"
SEG = OUT / "seg"
FINAL = OUT / "vigil-e2e.mp4"
LIMIT_S = 180.0


def run(*args, cwd=None):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True, cwd=cwd)


def probe(path, entries="format=duration"):
    return subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", entries, "-of", "csv=p=0", str(path)], text=True
    ).strip()


def main():
    cut = json.loads((OUT / "cut.json").read_text())
    audio = {a["id"]: a for a in json.loads((OUT / "audio" / "index.json").read_text())}
    raw = OUT / "raw" / "take.webm"
    SEG.mkdir(exist_ok=True)
    parts = []
    for c in cut:
        i = c["id"]
        delay_ms = int(round(c["delayS"] * 1000))
        out = SEG / f"{i}.mp4"
        af = f"[1:a]aresample=48000,adelay={delay_ms}|{delay_ms},apad,atrim=duration={c['segmentS']},asetpts=PTS-STARTPTS[a]"
        if c.get("card"):
            # a static card under its narration: the screenshot looped for the segment, with a short fade-in
            png = OUT / "cards" / f"{c['card']}.png"
            vf = (f"[0:v]fps=30,scale=1920:1080:flags=lanczos,setsar=1,fade=t=in:st=0:d=0.3,"
                  f"trim=duration={c['segmentS']},setpts=PTS-STARTPTS[v];")
            run(
                "-loop", "1", "-framerate", "30", "-t", f"{c['segmentS'] + 0.5:.3f}", "-i", str(png), "-i", str(OUT / "audio" / audio[i]["mp3"]),
                "-filter_complex", vf + af,
                "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", str(out),
            )
            parts.append(out)
            print(f"  {i}: {c['segmentS']:.2f}s (card {c['card']})")
            continue
        hold = max(0.0, c["holdS"])
        # one trim per kept range, concatenated, then the hold on the last frame
        parts_f = "".join(f"[0:v]trim=start={s}:end={e},setpts=PTS-STARTPTS[r{k}];" for k, (s, e) in enumerate(c["ranges"]))
        joined = "".join(f"[r{k}]" for k in range(len(c["ranges"])))
        vf = (parts_f + f"{joined}concat=n={len(c['ranges'])}:v=1:a=0,fps=30,scale=1920:1080:flags=lanczos,setsar=1"
              + (f",tpad=stop_mode=clone:stop_duration={hold:.3f}" if hold > 0.01 else "")
              + f",trim=duration={c['segmentS']},setpts=PTS-STARTPTS[v];")
        run(
            "-i", str(raw), "-i", str(OUT / "audio" / audio[i]["mp3"]),
            "-filter_complex", vf + af,
            "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", str(out),
        )
        parts.append(out)
        print(f"  {i}: {c['segmentS']:.2f}s (hold {hold:.1f}s, {len(c['ranges'])} range{'s' if len(c['ranges']) > 1 else ''})")
    lst = SEG / "list.txt"
    lst.write_text("".join(f"file '{p.name}'\n" for p in parts))
    concat = SEG / "concat.mp4"
    run("-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(concat))
    run("-i", str(concat.relative_to(OUT)), "-vf", "ass=captions.ass",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "copy", "-movflags", "+faststart", FINAL.name, cwd=OUT)
    shutil.copy(OUT / "captions.srt", FINAL.with_suffix(".srt"))
    total = float(probe(FINAL))
    wh = probe(FINAL, "stream=width,height,r_frame_rate")
    rows = max(1, -(-int(total // 5 + 1) // 6))
    run("-i", str(FINAL), "-vf", f"fps=1/5,scale=480:-1,tile=6x{rows}", str(OUT / "contact.png"))
    print(f"\n{FINAL.name}: {total:.1f}s, {wh}")
    if total > LIMIT_S:
        sys.exit(f"over the 3:00 ceiling by {total - LIMIT_S:.1f}s — apply the cut list in video/tts.py and re-run tts → captions → build")
    print("ok: under 3:00. Contact sheet:", OUT / "contact.png")


if __name__ == "__main__":
    main()
