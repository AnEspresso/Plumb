#!/usr/bin/env python3
"""Pack only the changed app files into a GitHub-shaped zip.

Paths inside the zip match AnEspresso/Plumb:
  app/index.html
  app/plumb.html
  ...
Unchanged trees (functions/, .github/) are omitted unless passed.
"""
from __future__ import annotations

import argparse
import re
import zipfile
from pathlib import Path

ROOT = Path("/workspace/siteplumb")
PUB = ROOT / "publish"

# (source relative to ROOT, path inside the zip / GitHub)
APP_CORE = [
    ("app/index.html", "app/index.html"),
    ("app/plumb.html", "app/plumb.html"),
    ("app/sw.js", "app/sw.js"),
] + [
    (str(p.relative_to(ROOT)), str(p.relative_to(ROOT)))
    for p in sorted((ROOT / "app" / "tour-audio").glob("*.mp3"))
] + [
    ("app/tour-audio/cues.json", "app/tour-audio/cues.json"),
]
APP_CI = [
    ("app/sim.js", "app/sim.js"),
    ("app/qa.js", "app/qa.js"),
]
ROOT_CORE = [
    ("index.html", "index.html"),
    ("404.html", "404.html"),
]


def sync_ship_bar(version: str) -> None:
    """Keep the homepage bar on the same version as the zip."""
    p = ROOT / "index.html"
    t = p.read_text()
    line = version + " is ready to publish."
    t2, n = re.subn(r"\d+\.\d+\.\d+ is ready to publish\.", line, t, count=1)
    if n != 1:
        bar = (
            '<div id="shipBar" style="background:#1c1916;color:#f7f4ef;padding:12px 18px;'
            'font:15px/1.4 -apple-system,sans-serif;text-align:center">\n  '
            + line
            + '\n  <a href="/publish/" style="color:#f7f4ef;margin-left:10px">Download the files</a>\n</div>\n'
        )
        if "<body>" not in t:
            raise SystemExit("marketing index.html has no body tag")
        t2 = t.replace("<body>", "<body>\n" + bar, 1)
    p.write_text(t2)


def write_zip(version: str, extra: list[tuple[str, str]] | None = None) -> Path:
    extra = extra or []
    sync_ship_bar(version)
    pairs = list(APP_CORE) + list(APP_CI) + list(ROOT_CORE) + list(extra)
    missing = [src for src, _ in pairs if not (ROOT / src).is_file()]
    if missing:
        raise SystemExit("missing: " + ", ".join(missing))
    mkt = (ROOT / "index.html").read_text()
    if (version + " is ready to publish.") not in mkt:
        raise SystemExit("marketing bar does not match " + version)

    note = [
        f"SitePlumb {version}",
        "",
        "Upload each file into the same folder on GitHub (AnEspresso/Plumb).",
        "Do not rename. Do not put app files in the repo root.",
        "",
    ]
    folders: dict[str, list[str]] = {}
    for _, dest in pairs:
        folder = dest.rsplit("/", 1)[0] if "/" in dest else "(repo root)"
        folders.setdefault(folder, []).append(dest.split("/")[-1])
    for folder, names in folders.items():
        note.append(f"{folder}/")
        for n in names:
            note.append(f"  {n}")
        note.append("")
    note += [
        "On iPhone:",
        "1. Unzip in Files. You will see an app folder and two files at the top.",
        "2. github.com/AnEspresso/Plumb → app → Add file → Upload files.",
        "3. Pick the files inside the unzipped app folder. Do not rename.",
        "4. Then open the repo root (not app). Upload index.html and 404.html there.",
        "5. Commit. Wait about a minute. Gear should match this version.",
        "",
    ]
    zpath = PUB / f"Plumb-{version}.zip"
    if zpath.exists():
        zpath.unlink()
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("UPLOAD.txt", "\n".join(note))
        for src, dest in pairs:
            zf.write(ROOT / src, dest)
    return zpath


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("version")
    args = ap.parse_args()
    out = write_zip(args.version)
    print(out, out.stat().st_size)
