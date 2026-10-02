# SitePlumb

**true to the build** — a field-management app for independent custom-home builders.

SitePlumb keeps the daily record of a build in one place: field notes, jobsite photos, open items, the schedule with inspections, crew bookings and install packets, selections with upgrade and credit pricing, and money. It runs as a single installable web app.

SitePlumb is live at [siteplumb.com](https://siteplumb.com), with the app at [siteplumb.com/app](https://siteplumb.com/app/). Builders, their team, homeowners and crews sign in and share one live book per house through Firebase (Auth, Firestore, Storage, Cloud Functions). Anyone can try the example build at `/app/?demo=1` without an account.

---

## What's in this repo

- `index.html`, `homeowners.html`, `switch.html`, `pitch-a.html`, `site.css`, `img/` are the marketing site.
- `app/` is the app: a single `index.html` (kept byte-identical to `plumb.html`), the guest packet page `p.html`, `sw.js`, `manifest.json`, privacy and terms, and tour audio. `sim.js` and `qa.js` are its tests.
- `functions/` holds the Cloud Functions; `firestore.rules` and `storage.rules` are the security rules.
- `scripts/` holds walk, QA and maintenance scripts. `.github/workflows/` holds CI.
- `HANDOFF.md` is the working handoff for whoever picks up the code next.

## Publishing

The website is published by the `Publish site` workflow, which copies only the files listed in `scripts/build-site.sh` into a Pages artifact. Repo notes, scripts and tests are never served. GitHub Pages must be set to deploy from **GitHub Actions**.

## Rules for contributors

- Every change is a pull request; nothing is pushed straight to `main`.
- Never write a password, token or key into any file here. Secrets live in GitHub Secrets or the untracked `.secrets/` folder. The `Secret scan` workflow checks every push.

---

© 2026 Plumb. All rights reserved.

This software and its design are proprietary. No license is granted for reuse, redistribution, or modification without the owner's written permission.
