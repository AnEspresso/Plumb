# Tools that actually speed SitePlumb

No Figma-as-source. No Storybook. The live app is the canvas.

## Every change

```bash
# Logic (jsdom) — run this first
cd app && node sim.js

# Four surfaces, one glance — overflow fails the run
node scripts/contact-sheet.mjs
# open screenshots/contact/index.html
```

CI runs both. `qa.js` is the deep Chrome pass (fonts, hit-tests, pixels). `qa-smoke.js` is WebKit + Firefox.

## Visual regression

`app/qa.js` already diffs screenshots with pixelmatch.

```bash
cd app
node qa.js            # fail if >0.6% pixels moved
node qa.js --bless    # after an intended look change
```

Commit `app/qa-baseline/` when you bless so CI stops auto-blessing.

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
