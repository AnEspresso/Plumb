#!/usr/bin/env python3
"""Draw the orb's path on one still per slide.

   python3 scripts/tour-orbpath.py /workspace/screenshots/tour-symphony
"""
import json, os, sys
from collections import defaultdict
from PIL import Image, ImageDraw

DIR = sys.argv[1] if len(sys.argv) > 1 else "/workspace/screenshots/tour-symphony"
beats = []
if os.path.exists(DIR + "/beats.json"):
    beats = json.load(open(DIR + "/beats.json"))
elif os.path.exists(DIR + "/frames.json"):
    beats = json.load(open(DIR + "/frames.json"))

by = defaultdict(list)
for b in beats:
    if b.get("idx") is None or b["idx"] < 0:
        continue
    if b.get("orb"):
        by[b["idx"]].append(b)

out = []
for idx, items in sorted(by.items()):
    shot = None
    for b in items:
        f = b.get("file")
        if f and os.path.exists(os.path.join(DIR, f)):
            shot = os.path.join(DIR, f)
            break
    if not shot:
        continue
    im = Image.open(shot).convert("RGBA")
    dr = ImageDraw.Draw(im)
    pts = [(int(b["orb"]["x"]), int(b["orb"]["y"])) for b in items if b.get("orb")]
    if len(pts) < 2:
        continue
    for a, b in zip(pts, pts[1:]):
        dr.line([a, b], fill=(196, 154, 108, 200), width=3)
    for i, p in enumerate(pts):
        r = 5 if i not in (0, len(pts) - 1) else 8
        col = (231, 220, 198, 230) if i != len(pts) - 1 else (232, 90, 70, 240)
        dr.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=col)
    name = "orb-s%s.png" % (idx + 1)
    im.convert("RGB").save(os.path.join(DIR, name), quality=88)
    out.append({"slide": idx + 1, "title": items[0].get("title") or "", "file": name, "n": len(pts)})
    print("orb", name, "pts", len(pts))

json.dump(out, open(DIR + "/orbpath.json", "w"), indent=2)
print("orb slides", len(out))
