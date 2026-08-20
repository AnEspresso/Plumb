# Tools that actually speed SitePlumb

No Figma-as-source. No Storybook. The live app is the canvas.

## Every change (blocking)

```bash
# Logic (jsdom) — run this first
cd app && node sim.js

# One black action, pills on one line, no overflow
node scripts/sheet-contract.mjs

# Four surfaces, one glance — overflow fails the run
node scripts/contact-sheet.mjs
# open screenshots/contact/index.html
```

CI runs sim, subfilter, qa.js, engines, contact sheet, and the sheet contract.

Workbench → **Run census** is the same contract on whatever sheet is open. Copy it into a bug.

## Visual regression (local, look first)

Tight set only: home, house briefing, People, Add a sub, Company.

```bash
node scripts/pixel-tight.mjs            # fail if >0.6% pixels moved
node scripts/pixel-tight.mjs --bless    # after you looked at the shots
```

Baselines live in `app/qa-baseline/tight/`. Do not auto-bless in CI.

`app/qa.js` is the deeper Chrome pass (fonts, hit-tests, axe). Same --bless rule.

## Ink the Book

```bash
node scripts/ink-the-book.mjs
# on fail, open screenshots/ink-the-book/trace.zip in Playwright trace viewer
```

First Hour is the human gate before a real builder sits down. It is not a commit gate.

## Materials (tokens)

Open `app/tokens.html` — paper, oak, clay, type, 8px rhythm. If a color is not on that page, it does not go in the app.

## Cloud without touching live

Firestore emulator must **not** use 8080 (that is the preview). It uses **8088**.

```bash
npx firebase-tools@latest emulators:start --only firestore,auth,storage
```

Needs the laptop Firebase CI token (already pinned). Do not run against production to wipe QA.

## Errors

Workbench → Copy Bug Report. `Sync.event` already ships real-user errors home. Do not add Sentry until there is a DSN you want.

## Restore a pinned app

Top bar → tap to compare → download that zip. Branches:

- `restore-2.239.0`
- `restore-2.248.0`
- `restore-2.255.0` — last version before the gold-master rewrite
