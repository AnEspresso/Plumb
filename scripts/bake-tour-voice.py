#!/usr/bin/env python3
"""Recut Ara (or --voice) clips from app/tour-audio/cues.json.

Only clips whose spoken line changed are rebuilt (see .hashes.json).

  python3 scripts/bake-tour-voice.py
  python3 scripts/bake-tour-voice.py --force
  python3 scripts/bake-tour-voice.py --only s2d
  python3 scripts/bake-tour-voice.py --voice luna
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path("/workspace/siteplumb")
CUES = ROOT / "app" / "tour-audio" / "cues.json"
AUDIO = ROOT / "app" / "tour-audio"
HASHES = AUDIO / ".hashes.json"


def auth_key() -> str:
    import os

    env = os.environ.get("XAI_API_KEY") or os.environ.get("GROK_API_KEY")
    if env:
        return env
    auth = Path.home() / ".grok" / "auth.json"
    if auth.exists():
        data = json.loads(auth.read_text())
        inner = next(iter(data.values())) if isinstance(data, dict) else {}
        if isinstance(inner, dict) and inner.get("key"):
            return inner["key"]
    raise SystemExit("No XAI_API_KEY or ~/.grok/auth.json key")


def digest(voice: str, text: str) -> str:
    return hashlib.sha256(f"{voice}\n{text}".encode()).hexdigest()[:16]


def tts(key: str, text: str, voice: str) -> bytes:
    body = json.dumps({"text": text, "voice_id": voice, "language": "en"}).encode()
    req = urllib.request.Request(
        "https://api.x.ai/v1/tts",
        data=body,
        method="POST",
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:
            last = e
            time.sleep(1.1)
    raise SystemExit(f"tts failed: {last}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--voice", default="")
    args = ap.parse_args()
    data = json.loads(CUES.read_text())
    voice = args.voice or data.get("voice") or "ara"
    want = {x.strip() for x in args.only.split(",") if x.strip()}
    prev = json.loads(HASHES.read_text()) if HASHES.exists() else {}
    key = auth_key()
    baked = skipped = 0
    AUDIO.mkdir(parents=True, exist_ok=True)
    for slide in data.get("slides") or []:
        for cue in slide.get("cues") or []:
            cid = cue.get("id")
            say = (cue.get("say") or "").strip()
            if not cid or not say:
                continue
            if want and cid not in want:
                continue
            h = digest(voice, say)
            dest = AUDIO / f"{cid}.mp3"
            if not args.force and dest.exists() and dest.stat().st_size > 2000 and prev.get(cid) == h:
                skipped += 1
                continue
            dest.write_bytes(tts(key, say, voice))
            prev[cid] = h
            baked += 1
            print(f"{cid}  {dest.stat().st_size}  {say[:56]}")
    HASHES.write_text(json.dumps(prev, indent=2) + "\n")
    print(f"baked {baked}  skipped {skipped}  voice {voice}")


if __name__ == "__main__":
    main()
