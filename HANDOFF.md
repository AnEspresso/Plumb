# SitePlumb — handoff (current build v2.242.0)

Paste this file into a new chat, attach the artifacts alongside it, and work continues without re-explaining anything.

---

## What SitePlumb is

A single-file PWA for residential construction project management — it connects the **builder**, the **subcontractors**, and the **homeowner** around one build. Peter is the owner/product lead and QAs on an iPhone; Grok writes all code and ships complete builds.

- **Live:** siteplumb.com (GitHub Pages, custom domain)
- **Repo:** `AnEspresso/Plumb` — app files in `app/`, marketing site at repo root, CI at `.github/workflows/qa.yml`
- **Backend:** Firebase project `plumb-467a0` (Blaze), Firestore + Auth + Storage, compat SDK 10.12.5, App Check enforced
- **Architecture:** `index.html` is the canonical single file; `plumb.html` is a **byte-identical parity copy** (both must always match)
- **Roles:** builder (`hillan`), subcontractor (`subs`), homeowner/client (`client`)

---

## Current state

**Pinned next after gold-master freeze:** Field Notes *file to* on the desk — optional trade + room after Send or on edit, so photos filter and land in that packet. Not on the field screen.

**v2.264.0 is live.** Five-spot walkthrough with a natural voice. Classic tour saved. 2.262 stays the sub-hat restore.

**Gold-master RC:** [GOLD-RC.md](GOLD-RC.md) — next is #1 empty-state hide + #2 All homes as a header.

**Tools now in the repo:** `node scripts/contact-sheet.mjs` (4 viewports, overflow fails), `app/tokens.html`, `TOOLS.md`, Firestore emulator on **8088**, CI job `surfaces`.

**Gold-master sim (locked):** North Oak Custom Homes. Quiet week + chaos week. iPhone / Android / Mac / PC. Score everything. QA logins wiped for the sim; restore from `qa-backup/pre-sim-2026-08-16T14-16` (10 builder/team sites + Calderwood homeowner). Demo mode not touched.

Restore (unchanged):
- `restore-2.239.0` (cc5faf9)
- `restore-2.248.0` (065dabe)

Restore (unchanged):
- `restore-2.239.0` (cc5faf9)
- `restore-2.248.0` (065dabe)

Restore:
- `restore-2.239.0` (cc5faf9) — before #2
- `restore-2.248.0` (065dabe) — #2 done, before 2–5

The black bar lists all three. Tap it, then download that zip.

The black bar on the marketing page is the download door. It always shows this version and opens `/publish/` (Save the GitHub zip). `pack-github.py` writes the number so it cannot drift.

**QA still to add** (pin — do in this order):
1. Live packet link (guest page as the sub) — done
2. Teammate account — done. `pmgottschalkqa+team@gmail.com` / `Pooperqa-team!?` (PM, Alex Rivera, all 10 sites). Also in `.secrets/qa_team_*`
3. Homeowner signed in — done. `pmgottschalkqa+home@gmail.com` / `Pooperqa-home!?` (Jordan Calderwood, 288 Calderwood Ln). Also in `.secrets/qa_home_*`
4. Signed-in sub — done. `pmgottschalkqa+sub@gmail.com` / `Pooperqa-sub!?` (Northwind Mechanical, HVAC, 288 Calderwood Ln). Also in `.secrets/qa_sub_*`
4. QuickBooks — done. QA login connected to Intuit sandbox “Sandbox Company US 066d”. Calderwood export: 5 sent, 4 already there, 0 failed.
5. Push notification — **PIN: wait for a laptop.** In-app notices are live (2.239). Lock screen needs a Firebase CI token (`firebase login:ci`) then Grok deploys `onPacketReply` + `notifyTest`. Cannot be done on the phone. Ask Peter when he has a computer.


**QA login:** The live QA account lives in `.secrets/qa_email` and `.secrets/qa_password` (never in the app or zip). Use it for real-mode live QA. Do not print the password. Do not put it in HANDOFF, the app, or the zip.

**Ship rule:** A GitHub write token is stored in `.secrets/github_ship` (never in the app or zip). When Peter says ship, **ask for the ship password first**. Do not push until he replies with the password in `.secrets/ship_password`. Do not print the password. Do not put it in HANDOFF, the app, or the zip.

Recent arc:

| Version | What shipped |
|---|---|
| 2.201 | Demo expanded 4 → 10 sites, one per build stage, full selections + money, reseeds on every entry |
| 2.202 | Demo role chips follow the active site instead of hardcoding Calderwood |
| 2.203–2.204 | Privacy/Terms open in an in-app sheet (z-index 220, above the demo banner); demo survives service-worker reloads |
| 2.205 | Production error telemetry — real-user errors report home over the existing Sync.event pipe, deduped, capped 5/session |
| 2.206–2.210 | **Guest sub packet links** (the big feature — see below) |
| 2.211 | **Bookings promoted to synced records** — they used to ride in the site meta blob (last-writer-wins), so two devices could silently wipe each other's bookings |
| 2.212 | Fixed a regression from 2.211: the packet prefetch called Firestore before App Check was activated, so every guest link was refused |
| 2.242 | Field and Notes sit beside the house in the lens |
| 2.236 | Double-booked names the dates. Their calendar shows the overlap |
| 2.235 | Packet updates say what changed. You can tell them |
| 2.234 | A sent packet updates live when the packet changes |
| 2.233 | Packet link sits after the review, never between |
| 2.232 | The reason you tapped leads the booking |
| 2.231 | Needs You opens the booking or a reply, not the calendar |
| 2.230 | The house card opens every still-open fact on that job |
| 2.229 | Needs You is one card per house and opens the packet |
| 2.228 | Gone quiet stays on home and opens what is up next |
| 2.227 | Confirm and reset emails open the app, not the marketing site |
| 2.226 | Closing a sheet returns you to the one underneath. Spec cards open the packet, not the site |
| 2.225 | Sheets stack. Needs You no longer pulls you off home |
| 2.224 | Install packet is a briefing: strip, still open, for the truck. Docs default hidden |
| 2.223 | Show all and Recent decisions are separate lines |
| 2.222 | Six new Needs You kinds: declined, blocked, site not ready, waiting, homeowner, on deck |
| 2.221 | Category Needs You cards. Confirm asks first and writes a receipt. Demo matches |
| 2.220 | Compact Needs You briefing. Clay bar only on blockers |
| 2.219 | Needs You live-listens packet replies so a force-quit is not required |
| 2.218 | Needs You confirm/answer on the card. House-card whisper. Live packet page |
| 2.217 | Needs You polls every few seconds while home is open |
| 2.216 | Chosen dates stay above the note. Schedule-a-sub uses the same range calendar |
| 2.215 | Range calendar for suggest-dates: start, end, check, note. No continue |
| 2.214 | Suggest new dates is both dates then a note. Leaving the calendar refreshes Needs You. One-day windows print as a single date |
| 2.213 | Packet links retry a refused first read instead of saying expired. Suggest new dates is Start then End. Confirm these dates is a real button that updates the open booking fields. Packet replies refresh within seconds so NEEDS YOU is not half an hour late |

**Test suites (all green at 2.213.0):**
- `sim.js` — 531 checks, jsdom, full app logic
- `subfilter.js` — sub-isolation fuzz, 25 subs × 10 sites, 3000 configs
- `qa.js` — 43 checks in real Chrome (Puppeteer): hit-tests, real fonts, pixel baselines, axe accessibility, monkey sweep, site coverage
- `qa-smoke.js` — WebKit + Firefox core flows (runs in GitHub Actions)
- GitHub Actions: `ritual` → `engines` → `verify-live`, all blocking

---

## The guest sub packet link feature (v2.206–2.213)

The design premise: **subs live in text messages, not apps.** So the packet arrives as an SMS, opens as one page, and is answerable in one tap — no account, no install, link expires on its own.

**Builder side:** open a booking → "Packet link…" (also offered right after scheduling, and on every calendar day-sheet row) → an **approval preview** shows the exact guest page → "Approve & text the link…" writes the snapshot and opens the share sheet.

**The snapshot** (Firestore `packets/{token}`, unguessable `pk`+32hex token, capability-URL pattern) is composed from the same trade-filtered accessors the in-app sub view uses, and carries:
- dates, note, trade, sub name, builder name
- install specs for that trade (with gaps marked "awaiting builder/homeowner")
- documents **strictly routed to that trade** (default-deny — untagged contracts/lien waivers never ride along)
- context: permit status (trade-specific, falling back to Building Permit), inspection state, site readiness (green ✓ / red ⚠), open punch items on their scope
- "Before you arrive" recent site history (their feed entries + shared milestones + latest daily-log lines)
- **No prices or budget data of any kind** (sim-asserted)
- **Text only** — no photo or file URLs, deliberately: the link expires but Storage URLs don't

**Guest side:** one-tap confirm, or suggest different dates (Start, then End, optional note — still available *after* confirming), ask a question, add to calendar (device .ics via Blob / Google Calendar template, with a remembered default), and a Preferences section.

**The loop back:** replies and questions stamp onto the synced booking and surface in the builder's **NEEDS YOU** feed automatically (background sweep on overview render, 12s for waiting packets, 45s for settled, and again when the phone comes online). Builder can accept suggested dates with **Confirm these dates** (updates the open sheet immediately; Save cannot overwrite a just-confirmed suggestion), answer questions inline (answer appears when the sub reopens their link), or **share a question to the homeowner** — builder edits the wording first, which *is* the approval gate. Nothing passes sub↔homeowner directly.

**Scheduling auto-arms specs:** saving a booking for a trade with unanswered install specs snaps the specs deadline to land 4 days before the crew arrives (only ever tightens) and toasts who owes what.

---

## Deploy ritual (strict order — never skip)

1. Python `re.subn` with `count=1` and `sys.exit(1)` on failure for every source edit (never `str_replace` on lines containing `\uXXXX`)
2. Version bump: `PLUMB_VERSION` + `APP_VERSION`
3. Changelog string: **no apostrophes, semicolons, or backslashes**
4. `sw.js` cache tag bump (`plumb-vX.X.X`)
5. Parity: `cp index.html plumb.html` then `diff -q`
6. Scans: CJK must be 0, double-backslash-u must be 0, identity sweep must be 2
7. `node --check` on the largest script block
8. `node subfilter.js` → PASS
9. `node sim.js` → exit 0
10. `node qa.js` → exit 0 (use `--bless` only for *intended* visual changes, after eyeballing the screenshot)
11. Stage to `/mnt/user-data/outputs/upload/` with `APP-` / `ROOT-` prefixes, then `present_files`

**Peter deploys** by uploading files through the GitHub web UI (laptop preferred; renaming on iPhone is fiddly). Zips sometimes lose the `.zip` extension on iOS — offering individual files is the reliable fallback.

**Every bug Peter finds becomes a permanent sim or qa check.** This is non-negotiable and has caught several regressions.

---

## Hard-won lessons (do not relearn these)

- **Bookings must stay in `SYNC_COLLS`.** They ride as records (`sub:'bk'`), not in the site meta blob. Meta is whole-object last-writer-wins and silently ate bookings across devices.
- **App Check must be activated after `initializeApp` and before the first Firestore call.** Skipping it makes reads unattested and refused. `_pkDb()` is the single init path for all packet code; sim asserts the ordering.
- **`openConfirm` takes `onConfirm`; `openPrompt` takes `onOk`.** Mixing them makes buttons silently do nothing.
- **Fraunces has an intrinsically hooked J and descending f** at every axis setting. All serif body text is Source Serif 4; Fraunces survives only on wordmark selectors.
- **Demo entry must run as the very last step of boot**, or plumbSuspend recovery stomps it back to real mode.
- **UI-layer bugs are invisible to jsdom.** Real-device screenshots and qa.js hit-tests are the only way to catch z-index/layout/tap-target issues.
- **`data:` URIs for .ics silently fail on iOS** — use a Blob URL.
- **The `verify-live` CI job must not byte-compare against the tested commit** — re-runs and later pushes make that fail forever. It compares versions instead.
- Per-account workspace isolation: `storeKey()` → `plumb.state.real.<uid>.v1`.
- Editing money never rewrites it: single-contract auto-pick fires on new entries only, never on edits.
- **Never map a permission-denied packet read to "this link has expired."** iMessage's in-app browser often fails App Check on the first try. Retry quietly; say "needs a connection" if it still cannot open.
- **Do not skip waiting packet sweeps for 30 minutes.** After a send, the first stamp is "no reply." A 30-minute skip hides the sub's reply. Waiting packets refresh after 12 seconds.
- **Confirm these dates must write the open booking fields.** A toast without refreshing `#bkStart` / `#bkEnd` lets Save write the old dates back over the accept.

---

## Environment

- Working dir `/workspace/siteplumb/` — marketing site at root, app in `app/`
- `app/index.html` is canonical; `app/plumb.html` is the parity copy
- node_modules: jsdom, puppeteer, playwright, @fontsource packages, pixelmatch, pngjs, axe-core
- Live-site and Firebase writes are always Peter's side

---

## Open queue

0. **PIN — laptop required:** Firebase CI token + deploy `onPacketReply` / `notifyTest` so packet replies hit the lock screen. Peter cannot do `firebase login:ci` on the phone. When he has a computer: `npx firebase-tools@latest login:ci`, paste the token, Grok deploys. Then QA: Gear → Notifications → Turn on → Send a test.

1. **Peter deploys 2.213.0** and re-runs the 12-step list (especially 4, 8, 9, 10, 11)
2. **New communication surfaces** (picked next, not built): NEEDS YOU stays the inbox; house card gets a quiet line; booking sheet is the full thread. No Messages tab.
3. **Trademark attorney clears "SitePlumb"** — the true go-to-market gate
4. **Push notifications when a sub replies** — currently NEEDS YOU updates when the app is opened; a real push needs a small Cloud Function (same pattern as the QuickBooks one)
5. **Estimating / takeoff** — the confirmed competitive gap, biggest remaining feature
6. Intuit production filing (QuickBooks sandbox is fully working: OAuth, vendor auto-creation, cost export, duplicate guard)
7. Design-partner outreach — the marketing site is ready
8. Tier-3: email verification at signup (partially built), logged-out marketing landing page
9. Queued QA upgrades: Firestore rules emulator suite (dedicated session), ESLint no-undef across script blocks, Lighthouse budgets in CI
10. Peter's side if desired: real-device farm (~$29–39/mo, would automate the last iPhone-only QA), UptimeRobot
11. Revisit: Firebase config is baked into the HTML so invitees can connect (standard practice, but Peter wants to revisit — delete `PLUMB_FIREBASE_CONFIG` to undo, which disables invite flows)

---

## Working agreements

- Peter drives with direct commands; the assistant leads technically, verifies against actual source before claiming anything, and ships complete builds rather than option menus
- Peter gives explicit approval before shipping ambiguous product decisions, but expects completeness once direction is set
- QA instructions for Peter: **numbered, super simple, one action per line, with ✅/❌**
- Bug reports arrive via Workbench "Copy Bug Report" (version, mode, role, sync state, UA, errors, last 30 events) — pasted directly into chat
- Bring independent construction-domain judgment; Peter is a homeowner building his own house, not a trade professional
