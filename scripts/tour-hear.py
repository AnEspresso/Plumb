#!/usr/bin/env python3
"""Transcribe every walk clip and diff it against cues.json.

  python3 scripts/tour-hear.py
  python3 scripts/tour-hear.py --live
"""
from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

ROOT = Path("/workspace/siteplumb")
CUES = ROOT / "app" / "tour-audio" / "cues.json"
AUDIO = ROOT / "app" / "tour-audio"
LIVE = "https://siteplumb.com/app/tour-audio"


def auth_key() -> str:
    import os

    env = os.environ.get("XAI_API_KEY")
    if env:
        return env
    data = json.loads((Path.home() / ".grok" / "auth.json").read_text())
    inner = next(iter(data.values()))
    return inner["key"]


def stt(key: str, mp3: bytes, name: str) -> dict:
    boundary = "----hear"
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}.mp3\"\r\n"
        f"Content-Type: audio/mpeg\r\n\r\n"
    ).encode() + mp3 + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        "https://api.x.ai/v1/stt",
        data=body,
        method="POST",
        headers={"Authorization": "Bearer " + key, "Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def norm(s: str) -> str:
    return " ".join((s or "").lower().replace("’", "'").replace("–", "-").replace("—", "-").split())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    cues = json.loads(CUES.read_text())
    want = {x.strip() for x in args.only.split(",") if x.strip()}
    key = auth_key()
    bad = 0
    rows = []
    for slide in cues.get("slides") or []:
        for cue in slide.get("cues") or []:
            cid = cue.get("id")
            say = cue.get("say") or ""
            if not cid or (want and cid not in want):
                continue
            if args.live:
                mp3 = urllib.request.urlopen(f"{LIVE}/{cid}.mp3", timeout=20).read()
            else:
                mp3 = (AUDIO / f"{cid}.mp3").read_bytes()
            got = stt(key, mp3, cid)
            text = got.get("text") or ""
            dur = got.get("duration")
            ok = norm(text) == norm(say) or norm(say) in norm(text) or norm(text) in norm(say)
            if not ok:
                bad += 1
            mark = "ok" if ok else "DIFF"
            line = f"{mark:4} {cid:5} {dur or 0:5.2f}s  want: {say[:50]}"
            print(line)
            if not ok:
                print(f"     heard: {text}")
            rows.append({"id": cid, "ok": ok, "want": say, "heard": text, "duration": dur})
    out = ROOT / ".." / "screenshots" / "tour-hear.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rows, indent=2))
    print(f"{len(rows)} clips  {bad} diffs")
    if bad:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
