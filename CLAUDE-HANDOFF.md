# SitePlumb — handoff for a new model

Written 2026-09-27, corrected the same night after 2.429 and the rules suite shipped.
Owner: Peter Gottschalk. The product is his. Do not redesign it to show you were here.

This file is the current truth. Several older docs in the same tree are not.
If this file and `README.md` disagree, this file wins. If this file and the
source disagree, the source wins, and you fix this file.

---

## 0. The job

Finish SitePlumb. Do not replace it.

It is already a live product: a phone-first book for an independent custom-home
builder running about two to twenty houses. The builder, the homeowner, and the
crew each have a hat. Crew who will not install an app get a texted link.

"Complete" does not mean a new architecture, a new visual system, or a chat
assistant on the camera. It means the book a builder already uses does not lie,
does not dead-end, and does not leak another house — and the few named gaps
below are closed only after that is true.

Peter approves product decisions that change what a person sees. Once he says
do it, ship the whole thing, not a sketch. QA steps you give him are numbered,
one action per line, with a check and a cross. He is building his own house.
He is not a trade. Bring construction judgment anyway. The buyer of this app
is a custom-home builder.

---

## 1. Where it lives

| Thing | Where |
|---|---|
| Live site | https://siteplumb.com |
| Live app | https://siteplumb.com/app/ |
| Example book | https://siteplumb.com/app/?demo=1 |
| Guest packet page | https://siteplumb.com/app/p.html |
| Repo | https://github.com/AnEspresso/Plumb (`main`) |
| Firebase project | `plumb-467a0` (us-central1) |
| Also allowed origin | `https://anespresso.github.io` |
| This tree | marketing site at the repo root, app in `app/` |

Source version, live on https://siteplumb.com/app/ as of the evening of 2026-09-27:

- `PLUMB_VERSION` = `2.429.0 - An invited crew sees their own bookings`
- `APP_VERSION` = `1790536420997`
- `app/sw.js` cache = `plumb-v2.429.0`
- `app/index.html` and `app/plumb.html` stay byte-for-byte the same

`HANDOFF.md` in the repo may still say an older version. This file wins over
that one. The phone runs whatever GitHub Pages last published, and an
installed copy keeps the old service-worker cache until the cache name changes.

---

## 2. What not to trust

| File | Why |
|---|---|
| `README.md` | Says v0.5, demo only, no backend. False. Ignore it. |
| `HANDOFF.md` bottom "Open queue" items 1, and parts of 2, 4, 8 | Written when 2.213 still needed a deploy. The book, the packet loop, Needs You, and a soft email-verify path have shipped since. Read the source before treating those lines as work. |
| `pitch-b.html` | A redirect to `/`. Not a second pitch. |
| `codex/siteplumb-communication-loop-qa` @ `051b2a82` | Read only. Do not merge. The useful behavior is already in this tree, mixed in those commits with things we do not want. |
| `codex/staging-recovery-appcheck` @ `cab87fa` | The Astra overlay plus `qa/staging/`. A spec, not a deploy. |
| `restore/2.319.0-full-site/` and `publish/Plumb-*.zip` | History. Not the app. |
| `_backup-site-2026-08-29-pre-agency/` | Old marketing. Not the site. |

Gold-master freeze (checked, do not reopen as a project): `GOLD-RC.md`. The
rewrite baseline before that freeze is `2.255.0`.

---

## 3. Laws (break these and you have the wrong app)

- Paper `#F2EEE6`, ink `#1B1916`, oak `#B0895A`, clay `#B0604A`, sage `#6F7B58`.
  Clay is for blockers only. If a color is not on `app/tokens.html`, it does
  not go in the app. The site uses the same tokens in `site.css`.
- Type: Hanken Grotesk for UI, Source Serif 4 for headings and body serif.
  Fraunces is the wordmark only. Its J and f are wrong everywhere else.
- Phone first. One bottom sheet for every modal. A fixed way back, at the
  bottom, on every page that is not the page you came from.
- Capture stays. The Field Notes control is `#ovCapture` / `openFieldNote()`.
  Do not hide it. Do not put a suggestion on it.
- No second app, no overlay, no `workspace.js` / `workspace.css`, no reskin,
  no Messages tab, no new brand.
- Do not split `app/index.html` into a framework. It is the product. A build
  step is not an improvement.
- `app/plumb.html` is a copy of `app/index.html`. After every app edit:
  `cp app/index.html app/plumb.html` and `cmp` them. They must match.
- `app/p.html` is the guest packet. Same texted link, forever. Do not mint a
  new URL when the spec changes.
- Every bug Peter finds becomes a permanent check in `app/sim.js` (or
  `rulescheck.js` if it is a server rule).
- Changelog strings in `PLUMB_VERSION` contain no apostrophes, semicolons, or
  backslashes.
- Bookings stay in `SYNC_COLLS`. They are records, not a blob inside site meta.
  Meta is last-writer-wins and has eaten bookings before.
- App Check is activated after `initializeApp` and before the first Firestore
  read. A refused first read on a packet is a retry, not "this link expired."
- A homeowner and a sub are not company roles on the signup picker. They join
  with an invite.
- Sign out and delete account return to the door (the splash), not to a
  half-loaded book.
- Do not deploy `qa/staging`. Do not probe another customer's live records.

**PINNED — do not build. Field Note photo assist.**
After the photo, do not guess the house, the room, or the kind of note.
The person already chooses those and hits Send. A wrong guess on a job is
worse than that sheet, and the note has to file with no signal. Membership
on the server only stopped a note landing on the wrong house. That is not
a reason to turn the guess on.

---

## 4. The four hats, plus the guest

| Hat | How they get in | What they are allowed to see |
|---|---|---|
| Builder | Creates the company. Email and password. | The book. Every house they belong to. Money. Company. Invites. |
| Team | Invite from the builder. Not a signup role. | The houses the invite published. Not a second company. |
| Homeowner | Invite. Not a signup role. | Their house. Decisions first. Money folded, not a job-cost report. |
| Crew (sub) | Invite, scoped to a trade. | Their scope. Not another house. Not the builder's margin. |
| Guest crew | Texted link, no account. `packets/{token}` opened by `p.html`. | That packet only. No prices. No photo URLs. Confirm binds to the current spec. |

QA logins (no passwords in this file — Peter has them):

- Builder `pmgottschalkqa@gmail.com`
- Team `pmgottschalkqa+team@gmail.com`
- Homeowner `pmgottschalkqa+home@gmail.com`
- Sub `pmgottschalkqa+sub@gmail.com`

There is also a homeowner Peter made while testing (`pmgottschalkhomeqa@gmail.com`).
Do not invent passwords. Do not write them into the repo.

A public visitor never sees the guided walk. The walk is QA and the owner
only (`walkAllowed()`).

---

## 5. What the app already does

This is the book. It is in one file, `app/index.html`.

**Door.** Splash, create account, sign in, password reset that lands in the
app, sign out and delete account back to the splash. First-run setup names
the company once. First house is the only door until a house exists.

**Builder book.** Houses, search, A–Z by street name with the number stripped
(Cottage before Elmhurst). Add a house and land in that house, not back on
the overview. Saving is one house, not the whole book. Desktop at 1100px and
up: month calendar on the left, house list on the right.

**Field Notes.** Camera, a kind chip, a few words, Send. Three taps on the
job. Optional trade and room after send, on the desk, so it can land in a
packet. Photos in IndexedDB. Not a chat. Not an assistant.

**The house.** Schedule and stage, inspections, permits, daily log, documents
with an audience, selections and specs, build brief (what matters, the look,
the tradeoffs — builder and homeowner write it, crew reads it, it syncs).

**Packets.** One next packet on the home of the house. Needs You stays the
inbox. Spec diffs show. Sign-off and crew confirm drop when required install
details change, a selection is added or removed, or a packet document is
replaced. They do not drop for dates, prices, notes, the brief, or unused
optional specs. The same texted link republishes. Crew confirms the current
packet, records what was installed, builder verifies. A stale link says the
old confirm does not count.

**Needs You.** Questions, date changes, decisions. Closing one returns to the
list. Confirm sits above the sheet that asked for it.

**Money.** Selections carry upgrade and credit. Invoices, payments, job cost
(budget, committed, spent), CSV for an accountant, QuickBooks sandbox
(OAuth, vendor, cost export, duplicate guard). Homeowner sees costs and
payments folded under the house, closed until tapped. Invoice OK is a
decision. Crew does not get the margin.

**People.** Invite homeowner, crew, team. Mint and revoke. A claim is
written by the server onto the house (`onInviteClaim`), not by the phone
that happened to be open. The joiner's hat is stored on their user doc
(`hatRole`, `hatSite`) so a later sign-in does not come back as the wrong
person or an empty book.

**Homeowner paper.** Home, Schedule, Selections, Updates, Documents, Costs
and payments, build brief, raise a concern, share with the builder. House
sits at the bottom of every one of those pages. If the builder has not
shared the house yet, the screen says so. It is not a dead end. Settings
for a homeowner is not the Company sheet.

**Offline.** The phone writes first. Firestore catches up. The status line
says what is true (synced, saving, or saved on this phone). A security-rule
refusal surfaces as sync blocked — that toast means the write was illegal,
not that the radio is bad.

**Account.** Privacy, delete account (Cloud Function), notifications, a
test push when the phone already has a token.

**Workbench.** Owner and QA only. Bug report, layout snapshot, sheet census.
Copy Bug Report is how Peter sends a bug: version, mode, role, sync, last
events.

---

## 6. The website

Static, no framework, same palette as the app. GitHub Pages. `CNAME` is
`siteplumb.com`. An installed icon that still opens `/` is redirected into
`/app/` before first paint (`index.html` head script). A password-reset or
verify link that hits `/` is forwarded into `/app/` with the query kept.

| Page | Job |
|---|---|
| `/` `index.html` | The book for custom home builders. Example book and a mailto for a free first-house Zoom. |
| `/homeowners.html` | What an invited homeowner should expect. Their house only. |
| `/switch.html` | For builders leaving CoConstruct. Smaller, selections and the homeowner. |
| `/pitch-a.html` | How it works. Linked from the home offer. |
| `/pitch-b.html` | Redirect home. Leave it. |
| `/app/privacy.html` `/app/terms.html` | Legal. Privacy opened from Legal returns to Legal. From the door it stays at the door. |
| `site.css` | Site tokens and layout. Do not invent a second palette. |

The offer copy is deliberate: free while early, Zoom for the first house
only, no card, notice before that changes. Do not "improve" it into a
pricing page.

Counsel briefing (not the public site): `docs/SitePlumb-Counsel-Briefing.pdf`.
Trademark clearance of the name SitePlumb is a lawyer's job, not a code job.
It is still the go-to-market gate.

---

## 7. How the code is shaped

```
app/index.html     the app. Canonical.
app/plumb.html     must match index.html exactly
app/p.html         guest packet
app/sw.js          cache name must equal SW_CACHE_EXPECTED
app/sim.js         logic tests (jsdom). Last claimed green count was 1,007. Re-run; do not quote a stale count.
app/subfilter.js   crew cannot see another crew's work
app/qa.js          real Chrome: hit targets, type, axe
app/tokens.html    the visual law
firestore.rules    published rules (firestore-next.rules is currently the same file)
rulescheck.js      runs those rules in the emulator
functions/         Cloud Functions
index.html         marketing home
```

Inside `app/index.html`, the large pieces sit near these line regions
(line numbers drift — search the comment):

- visual system, one sheet, tokens — around the "Button — three roles" block
- `PLUMB_VERSION` — search that name
- IndexedDB photos, then persistence
- login, session, overview — "login + session"
- invites and claims — "org membership, invites, claims"
- settings — `renderSettings`
- sync — "sync layer", `SYNC_COLLS`
- Field Notes — `openFieldNote`
- homeowner — `renderClient`, `clientGo`, `clientProj`

`SYNC_COLLS` (these subcollections ride with the house):

| Field on the house | Firestore subcollection |
|---|---|
| items | items |
| bookings | bk |
| selections | sel |
| logs | logs |
| payments | pmts |
| mailReview | mail |
| costs | costs |

Site document holds members, memberUids, and meta (brief, packet sign-off,
packet work, memberInfo). Money reads are builder-only at the rule layer
for costs and mail. A sub reading `pmts` is denied. The client still reads
their own `pmts`. The listener must not subscribe to a collection the role
cannot read, or every session toasts "Cloud sync is blocked."

Other Firestore paths:

- `invites/{code}` — get by exact code if signed in, no list
- `invites/{code}/claims/{uid}` — create only as yourself; read if you are
  that uid or the builder who sent the code (`createdBy`); no update, no delete
- `users/{uid}` — your doc only. Allowed keys include `hatRole` and `hatSite`
- `packets/{token}` — guest work is shaped (fp, ack, installed) and only
  while the packet is signed, not stale, not revoked, not on a deleted house
- `orgs/{orgId}` — members; list denied
- `telemetry/**`, `qb/**`, `qbStates/**` — client read and write denied

Cloud Functions (`functions/index.js`), project `plumb-467a0`:

| Function | What it does |
|---|---|
| `onInviteClaim` | On claim create, stamps members / memberUids / meta on the house (or every house, for a team invite). Idempotent. Will not downgrade a builder or upgrade a homeowner into the company. |
| `onPacketReply` | Lock-screen push to builder uids when a guest packet changes |
| `notifyTest` | "Send a test" from notifications |
| `deleteAccount` | Account deletion |
| `qbConnect` `qbCallback` `qbStatus` `qbDisconnect` `qbExportCosts` | QuickBooks sandbox |
| `telemetryBeat` `telemetryEvent` `telemetryUsage` `telemetryClear` | Server-side only. The client cannot write telemetry. |

`functions/lib/claimStamp.js` is the pure stamp. `functions/claimStamp.test.js`
checks that function. Run it with `npm run claimstamp` from the repo root.
The rule text check is not enough. `rulescheck.js` is the real one. A crew
is stamped with the roster name on the invite, not the name they typed.

---

## 8. Security checks that actually ran

On the evening of 2026-09-27, GitHub Actions ran the suite from a clean
checkout of `main` (workflow `Rules suite`, and again as the `test` job
inside `Deploy Firestore rules`).

Result, production and staging, both times: **107 invariants passed**, plus
8 documented gaps that still deny. No live house was touched. The deploy
job then printed `ALREADY: live rules match repo` and published nothing.

`npm run rules` and `npm run rules:next` live in the root `package.json`.
`.github/workflows/rules.yml` runs them on a rules or functions change.
`.github/workflows/deploy-rules.yml` calls that suite first. A failing
suite cannot publish rules.

The 96 count in older notes was a sandbox file that never reached GitHub.
Do not quote it.

The claim invariants, in particular:

- The joiner can read their own claim.
- The builder who sent the code can read and list claims on it.
- A stranger, another member, and a signed-out person cannot read it.
- A stranger cannot list claims.
- A claim cannot be updated or deleted.
- You can create only your own uid.
- A stranger who merely holds the code cannot revoke the invite.
- Another builder cannot revoke a code they did not send.

`storage.rules` is named in `firebase.json` and is **not in this tree**.
Storage checks are skipped until that file exists. Do not invent one and
call it the deployed rules. Fetch the live storage ruleset before you edit
storage behavior.

Sharp edge, do not "clean up" casually: some denied house updates hit
Firestore's 1000-expression ceiling inside `clientSignoffOk` (every trade
is unrolled). They fail closed. An allow that the owner needs still
passed in that run. Shrinking the rule is a security change, not a refactor.
Do it only with the emulator suite green before and after.

The 1,007 `sim.js` checks do not open Firestore. Both suites have to be
green. Neither replaces the other.

---

## 9. What shipped recently (so you do not rebuild it)

| Version | What changed for a person |
|---|---|
| 2.423 | Sign out and delete return to the door. Homeowner and crew join by invite. |
| 2.424 | The house you add is the house you open. Homeowner waits, on screen, until the builder shares it. |
| 2.425 | Save is one house. The homeowner keeps their hat after sign out. Another phone cannot overwrite who lives there. |
| 2.426 | Selections is not a dead end. Settings is not Company. Signing back in does not empty the book. |
| 2.427 | House sits at the bottom of every homeowner page. A–Z sorts by street, not the house number. |
| 2.428 | The claim writes the house on the server. The status line tells the truth. Delete lives under Privacy. A stale crew link says the old confirm does not count. |
| 2.429 | An invited crew is stamped with the roster name, and the crew phone filters bookings on that same name. Crews who already joined are not rewritten by the app. A dry run on 2026-09-27 found 0 crews to rename. |

Also already in the tree from 2.415–2.419, do not re-implement:

- Home shows the next packet. Needs You and Field Notes stay.
- Spec fingerprint drops sign-off and crew confirm only for the cases in the laws above.
- Crew confirm, installed, builder verify. Guest confirm on the texted link.
- Build brief on the house.
- Homeowner: decisions first, money folded.
- Server-side packet rules so confirm is bound to the current spec.

---

## 10. What is actually left

Do these in order. Do not start at the bottom because it is more interesting.

### A. Prove the live book before you add anything

1. Confirm production is serving `2.429.0` / cache `plumb-v2.429.0`, not an
   older installed copy. An old service worker looks like "your fix did nothing."
2. Walk four hats. Scripts already exist: `scripts/front-door.mjs` (doors
   open), `scripts/whole-book.mjs` (doors used), `scripts/ink-the-book.mjs`
   (a business day on a throwaway house, then wipe). Read `FRONT-DOOR.md`,
   `WHOLE-BOOK.md`, `INK-THE-BOOK.md`.
3. `npm run rules` from the repo root was green on 2026-09-27 (107 + 8).
   Re-run it if you touch rules. Do not bless a red check by editing the
   assertion to match a bug. `node sim.js` from `app/` was 1011 and green
   on the 2.429 push. The Chrome pixel job on that same push was red
   (tour offer, calendar chooser, three pixel baselines). That is not a
   rules failure. Do not re-bless pixels without a person looking.

### B. Holes that are still real

Confirm each one in the source and, for functions, in what is actually
deployed. The HANDOFF queue is older than the code.

1. **Lock-screen push.** `onPacketReply` and `notifyTest` are in the source.
   The old note said they were not deployed because that needed a laptop
   Firebase token. Find out if they are live before you write them again.
   QA, if they are live: Gear, Notifications, Turn on, Send a test.
2. **Email verification** is a soft gate (sim section 14o). It is not a hard
   wall. Leave it soft unless Peter says otherwise.
3. **QuickBooks is sandbox.** Production Intuit filing is a business step,
   not a UI rewrite. Do not point the app at production keys on a hunch.
4. **Estimating / takeoff** is the named gap against other builder software.
   It is the largest unbuilt feature. Do not start it until A is clean.
   If you do start it, it is a sheet in this book, not a new product.
5. **Storage rules file missing from the repo.** The suite now says
   `STORAGE: SKIPPED` on every run. Recover the live ruleset into
   `storage.rules` so the emulator can enforce it. Do not invent one.
   Do not widen it. Not started.
6. **Rules weight.** The 1000-expression ceiling. Only if a real owner
   update is being denied because evaluation gave up. Not as cleanup.
7. **Two houses can share a street.** A retire script exists
   (`scripts/retire-dup-street.mjs`). It groups by street, not by the full
   label. It must stay a dry run until a human looks. It must not delete a
   house that has notes, selections, or money. Cottage was left alone on
   purpose when two records existed.
8. **ESLint `no-undef` across the script blocks, and a Lighthouse budget.**
   QA. After the book is trustworthy.
9. **Firebase web config is baked into the HTML** so an invitee can connect.
   That is normal. Peter has said he may want to revisit it. Do not delete
   `PLUMB_FIREBASE_CONFIG` — that kills invites.

### C. Not code

- Trademark attorney on the name SitePlumb.
- Design-partner conversations. The site is far enough along to send a
  builder to. Do not hold the site for a redesign.
- A real-device farm and an uptime check, if Peter wants them. Not a
  substitute for the walk above.

### D. Explicitly not the work

- Photo assist on Field Notes.
- Astra workspace overlay.
- A React or TanStack rewrite. (This sandbox also contains an unused app
  template at `/workspace/src`. That is not SitePlumb. Do not merge them.)
- A Messages inbox.
- Cherry-picking the codex branches.
- Merging `firestore.rules` and `firestore-next.rules` as a project. They
  are already the same bytes. Keep them in sync if you ever edit one.

---

## 11. How to change the app

1. Edit `app/index.html` only. Then copy it onto `app/plumb.html`.
2. Bump `PLUMB_VERSION`, `APP_VERSION` (epoch ms), and `app/sw.js` `CACHE`
   together. `SW_CACHE_EXPECTED` must match the cache name.
3. Version sentence: no apostrophes, semicolons, or backslashes.
4. Add a sim check that fails on the old behavior.
5. From `app/`: `node --check` on the largest script block, `node subfilter.js`,
   `node sim.js`. Scans: no CJK, no doubled `\u` escapes, the word AnEspresso
   appears exactly twice (identity sweep).
6. If you touched rules: `npm run rules` from the repo root. Port 8088.
   Never 8080. Never the live project.
7. If you touched pixels: `node qa.js`, and `node scripts/sheet-contract.mjs`.
   `--bless` only after a person has looked.
8. Peter publishes by putting the files on `main`. GitHub Pages serves the
   site. Rules publish through `.github/workflows/deploy-rules.yml`
   (`workflow_dispatch`, secret `FIREBASE_SERVICE_ACCOUNT_PLUMB`). Functions
   through `deploy-functions.yml`. Do not invent a second host.

Python `re.sub` with a count, not a blind replace, when a line contains
`\u` escapes. A sloppy replace has corrupted this file before.

UI bugs (a sheet behind another sheet, a tap that misses, a button under
the home indicator) do not show up in jsdom. `qa.js` and a phone do.

---

## 12. Test map

| Say this | Script | What it proves |
|---|---|---|
| (always) | `cd app && node sim.js` | The book still does what the checks say |
| (always) | `cd app && node subfilter.js` | Crew isolation |
| run the rules | `npm run rules` | Server refuses what it must |
| run the Front Door Check | `node scripts/front-door.mjs` | Each hat can open the door |
| run the Whole Book | `node scripts/whole-book.mjs` | Each hat can use the door and leave |
| run Ink the Book | `node scripts/ink-the-book.mjs` | A day on a throwaway house, then wipe |
| run the public face | `node scripts/public-face.mjs` | A stranger sees no version bar and no walk |
| run the first hour | `node scripts/first-hour.mjs` | A brand-new builder, empty book |

Ink the Book must not text a real SMS and must not leave junk in the QA
book. A $1 INK TEST line in the QuickBooks sandbox gets deleted there.

GitHub Actions (`.github/workflows/qa.yml`): ritual (parity, scans, sim,
Chrome qa) and browser engines, plus a rules job when rules or `rulescheck.js`
change. The rules job was added in this tree on 2026-09-25. Confirm it is
on `main` before you rely on it.

---

## 13. Deploy ritual

Strict order when the app itself changes:

1. Source edit, with the `\u` caution above
2. Version bump: `PLUMB_VERSION`, `APP_VERSION`, changelog sentence
3. `sw.js` cache tag
4. `cp app/index.html app/plumb.html` and `cmp`
5. Scans and `node --check`
6. `node subfilter.js`, `node sim.js`, and rules if rules changed
7. `node qa.js` when the picture changed
8. Peter puts it on `main`

Live Firestore writes and production deploys stay on Peter's side unless
he has already given the workflow the service account. Do not ask him to
paste a key or a password into chat.

---

## 14. First week, if you are Claude

Day one is read-only.

1. Read this file, then `app/index.html` at `PLUMB_VERSION`, `SYNC_COLLS`,
   `renderClient`, `renderSettings`, `openFieldNote`, `siteRoleFor`.
2. Read `firestore.rules` matches for `sites`, `claims`, `packets`, `users`.
3. Read `functions/index.js` `onInviteClaim` and `functions/lib/claimStamp.js`.
4. Run sim and the rules suite. Write down the real counts.
5. Open the live app and confirm the version string in Workbench or the
   settings footer. If it is not 2.429.0, stop and say so.
6. Come back with a list of what is broken that you have seen, not a
   redesign. Peter will say which one to do.

Do not start estimating. Do not start the photo assistant. Do not open a
pull request that reformats `index.html`.

---

## 15. Paste this to Claude

```
You are finishing SitePlumb, not replacing it.
Read CLAUDE-HANDOFF.md before you touch a file. README.md is stale. Ignore it.
The app is app/index.html (2.429.0). app/plumb.html must stay a byte copy.
app/p.html is the guest packet. app/sw.js cache must match SW_CACHE_EXPECTED.
Paper, oak, clay. Capture stays. No overlay. No photo assistant. No Messages tab.
Homeowners and crew join by invite. They are not signup roles.
A claim stamps the house on the server. Do not move that back to the phone.
Prove sim.js and the Firestore rules suite are green before you add a feature.
The largest unbuilt feature is estimating, and you do not start it until the
live book has no dead ends. Come back with what is actually broken.
```
