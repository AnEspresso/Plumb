# Plumb

**true to the build** — a field-management app for independent custom-home builders.

Plumb keeps the daily record of a build in one place: dated job logs, jobsite photos, open items, the construction schedule with inspections and permits, subcontractor coordination, and a selection/spec sheet with upgrade-and-credit pricing. It runs as a single, installable web app — no accounts to provision, no servers to stand up to try it.

This build is a **demo**: it ships with three fictional sample projects so you can explore every screen. All data is local to your device.

---

## Try it

Open the published page on your phone (Add to Home Screen for the full-screen app experience), or open `index.html` in any modern browser.

- **Builder** sign-in → portfolio of all sites, full access.
- **Subcontractors** sign-in → a restricted view scoped to a trade's own sites and tasks.

To reset the demo at any time: tap the small copyright text at the bottom five times, enter `plumb`, and use **Reload demo content**.

---

## What's inside

- **Daily log** — one dated entry per day, with editable history.
- **Photos & open items** — capture with a note, area, and assignee; flag anything that needs a fix.
- **Schedule** — evidence-based construction stages gated by the right inspections, with a per-site permit tracker.
- **Selections** — finishes by trade section with upgrade/credit amounts, buyer sign-off, special instructions, and a live **upcharge ledger** (overages − credits − payments = amount outstanding).
- **Installable PWA** — works offline once loaded; add it to a phone's home screen.

---

## Tech

A single self-contained `index.html` (HTML/CSS/JS, no build step) plus a PWA `manifest.json`, a `sw.js` service worker for offline caching, and app icons. Data is stored on-device (localStorage for records, IndexedDB for photos). No backend yet — live multi-device sync is the next phase.

### Run / host

Any static host works. For GitHub Pages: put these files in a repo, then **Settings → Pages → deploy from `main`, `/root`**. The published URL is public; the demo intentionally contains no real or sensitive data.

---

## Status

Demo build (v0.5). Front end complete; the data layer is structured so a hosted backend (sync, accounts, permit-email parsing, push) can drop in without reworking the app.

---

© 2026 Plumb. All rights reserved.

This software and its design are proprietary. No license is granted for reuse, redistribution, or modification without the owner's written permission.
