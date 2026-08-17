#!/usr/bin/env python3
"""What Ara actually said. Prefers the in-page tape (Playwright video is silent).
   Falls back to matching ffmpeg audio when a real soundtrack exists.

   python3 scripts/tour-hear.py /workspace/screenshots/tour-symphony
"""
import json, os, glob, subprocess, sys
import numpy as np

DIR = sys.argv[1] if len(sys.argv) > 1 else "/workspace/screenshots/tour-symphony"
CLIPS = "/workspace/siteplumb/app/tour-audio"
SR = 8000

says = {}
try:
    raw = json.load(open(CLIPS + "/cues.json"))
    for s in raw.get("slides") or []:
        for c in s.get("cues") or []:
            if c.get("id"):
                says[c["id"]] = c.get("say") or ""
except Exception:
    pass

def from_tape():
    path = DIR + "/tape.json"
    if not os.path.exists(path):
        return None
    tape = json.load(open(path))
    if not tape:
        return None
    heard, doubles = [], []
    last = None
    t0 = tape[0].get("ms") or tape[0].get("t") or 0
    for row in tape:
        clip = row.get("clip") or ""
        ms = row.get("ms") if row.get("ms") is not None else row.get("t")
        sec = round(((ms or 0) - t0) / 1000.0, 2) if ms and ms > 10000 else round((ms or 0) / 1000.0, 2)
        if row.get("voices", 0) > 1:
            doubles.append({"clip": clip or "overlap", "say": says.get(clip, ""), "times": [sec]})
        if clip and clip != last:
            heard.append({"t": sec, "clip": clip, "say": says.get(clip, ""), "score": 1, "src": "tape"})
            last = clip
    s1 = [h for h in heard if h["clip"] == "s1a"]
    if len(s1) > 1:
        doubles.append({"clip": "s1a", "say": says.get("s1a", ""), "times": [h["t"] for h in s1]})
    return {"ok": True, "src": "tape", "heard": heard, "doubles": doubles, "sec": (tape[-1].get("ms") or 0) / 1000.0}

def from_video():
    videos = [p for p in glob.glob(DIR + "/*.webm") + glob.glob(DIR + "/*.mp4") if os.path.getsize(p) > 1000]
    if not videos:
        return None
    video = max(videos, key=os.path.getmtime)
    wav = DIR + "/hear.wav"
    r = subprocess.run(
        ["ffmpeg", "-y", "-i", video, "-ac", "1", "-ar", str(SR), "-vn", wav],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if r.returncode != 0 or not os.path.exists(wav):
        print("hear: video has no audio track (Playwright is silent). using tape if any.")
        return None

    def load_wav(path):
        raw = subprocess.check_output(
            ["ffmpeg", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
            stderr=subprocess.DEVNULL,
        )
        return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0

    hay = load_wav(wav)
    windows = {}
    try:
        frames = json.load(open(DIR + "/frames.json"))
        for f in frames:
            c = f.get("cue")
            if not c or not str(c).startswith("s"):
                continue
            t = (f.get("ms") or 0) / 1000.0
            lo, hi = windows.get(c, (t, t))
            windows[c] = (min(lo, t), max(hi, t))
    except Exception:
        pass

    def peaks(hay, needle, t0=0, t1=None, hop=640, thresh=0.55):
        n = len(needle)
        if n < SR * 0.3:
            return []
        a0 = max(0, int(t0 * SR))
        a1 = min(len(hay), int((t1 if t1 is not None else len(hay) / SR) * SR))
        if a1 - a0 < n:
            return []
        nn = needle / (np.linalg.norm(needle) + 1e-9)
        found, i = [], a0
        while i + n <= a1:
            w = hay[i : i + n]
            sc = float(np.dot(w, nn) / (np.linalg.norm(w) + 1e-9))
            if sc >= thresh:
                t = i / SR
                if not found or t - found[-1]["t"] > 0.5:
                    found.append({"t": round(t, 2), "score": round(sc, 3)})
                i += n // 2
            else:
                i += hop
        return found

    heard, doubles = [], []
    for path in sorted(glob.glob(CLIPS + "/s*.mp3")):
        name = os.path.splitext(os.path.basename(path))[0]
        try:
            needle = load_wav(path)
        except Exception:
            continue
        if name == "s1a":
            hits = peaks(hay, needle, 0, 16)
        elif name in windows:
            lo, hi = windows[name]
            hits = peaks(hay, needle, max(0, lo - 2), hi + 3)
        else:
            continue
        for h in hits:
            heard.append({"t": h["t"], "clip": name, "say": says.get(name, ""), "score": h["score"], "src": "video"})
        if len(hits) > 1:
            doubles.append({"clip": name, "say": says.get(name, ""), "times": [h["t"] for h in hits]})
    heard.sort(key=lambda x: x["t"])
    return {"ok": True, "src": "video", "video": os.path.basename(video), "sec": round(len(hay) / SR, 1), "heard": heard, "doubles": doubles}

out = from_video() or from_tape()
if not out:
    out = {"ok": False, "reason": "no audio and no tape", "heard": [], "doubles": []}
json.dump(out, open(DIR + "/heard.json", "w"), indent=2)
print("hear src", out.get("src"), "lines", len(out.get("heard") or []), "doubles", len(out.get("doubles") or []))
for d in out.get("doubles") or []:
    print(" DOUBLE", d.get("clip"), d.get("times"), (d.get("say") or "")[:60])
for h in (out.get("heard") or [])[:10]:
    print(" ", h.get("t"), h.get("clip"), (h.get("say") or "")[:50])
