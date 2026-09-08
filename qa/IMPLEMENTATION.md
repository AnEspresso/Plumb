# SitePlumb communication-loop QA branch

This is the first reliability milestone toward the product vision, not a production release or a claim of 9/10 readiness. Preserve the existing house, book, office, typography, palette, and compact sheets. The software should prepare decisions and surface exceptions; users should not manage seven manual workflow statuses.

## Isolation

- Branch: `codex/siteplumb-communication-loop-qa`, based on `d321e31afc29d9f0a74f3d94ba15f147fcb9125d` (2.413.0).
- No production deployment, merge, Firebase rule update, database migration, real notification, or account change is part of this milestone.
- `app/runtime.js` permits the existing production Firebase configuration only on the exact production origins or the established GitHub Pages repository path. An absent runtime or any unknown origin disables cloud configuration and cloud-function calls.
- `npm run preview:build` creates `dist-qa` from an explicit asset allowlist. It forces local mode, blocks external connections with CSP, bundles local fonts, and adds a synthetic shower scenario. It does not copy repository handoffs, QA passwords, existing customer records, or backend environment files.
- The separately hosted preview uses these generated assets. It is private and sample-only. Its role switcher exercises the UI in one browser; it does not simulate authenticated users across devices. Reload and Start over reset the sample.
- Function deployment and production-version verification jobs are restricted to `main`. The ordinary branch QA jobs still run.

## Implemented

| Finding | Change | Regression coverage |
| --- | --- | --- |
| A failed packet update was considered synchronized | Record success only after the server write resolves; retain a visible failure and retry on the next sweep | Failed write, retry, unchanged no-op |
| Re-sharing split crew links and their conversation | Reuse a booking's active token, verify its scope, and preserve crew responses, questions, answers and expiry | Stable token, conversation preservation, wrong-crew rejection |
| Expired links needed a usable recovery | Explicit refresh updates instructions and expiry together on the same link | Atomic refresh, preserved conversation |
| Approvals survived changed instructions | Bind each approval to the exact current selection, date, scope, crew and routed-document content; preserve old approvals for history | Material edit, date/document changes, legacy signatures, stale review |
| New information arrived while preparing a link | Compare the displayed packet again before publishing/sharing | Change during async preparation |
| Homeowners could change field-owned details | Read-only field inputs plus ownership checks in the selection mutation path | Read-only UI and rejected forged mutation |
| Complete fields implied approval | Show “Details entered — approval pending” and a clear hold on unapproved crew instructions | Hold copy and absence of prices in packets |
| Crew submissions appeared successful before saving | Wait for the save, keep draft text on failure, append questions atomically with a stable retry ID | Both packet pages; failed confirmation and question retry |
| Cached instructions remained after revocation | Replace known expired/revoked instructions with an unavailable state; refuse a response | Revoked cached packet and blocked mutation |

Selection changes retain previous instruction content and increment `specRevision`. Current packet approvals filter out legacy signatures without an exact key. This intentionally asks for fresh review; it does not silently grandfather old signatures into a new release.

## Screenshot QA follow-up (2.415.0)

The 22 phone screenshots demonstrate initial dual approval, a finish change that invalidates both signatures, homeowner reapproval while the builder remains pending, and final approval of the updated finish. Following the in-app Test steps was valid; changing Finish instead of Rough-in dimension exercised the same material-revision check.

Implemented from that review:
- Routed selection cards, homeowner requests and counters derive approval from the current packet. They open its review rather than asking for a second selection sign-off. Unrouted selections keep their legacy flow.
- Packet summaries identify whose approval is pending. Reapproval shows field-level before/after changes against the previous approved instructions, including dimensions, dates, scope and document replacements. Prices stay off crew summaries.
- Builder approval is the primary action until signed; sharing becomes primary once both parties approve. Signed homeowner controls explicitly offer withdrawal rather than an ambiguous black “Signed” button.
- Instruction approval and the builder's site-readiness marker are labeled separately. A pending inspection is displayed as context; it is not assumed to block the work that precedes it. Crew home also shows a hold while instruction approval is incomplete.
- Credit balances use a credit label and absolute amount consistently. Excess invoicing is distinguished from future charges. Invoice balances remain visible separately. This is a presentation fix, not an accounting migration.
- Boolean or invalid clearance dates no longer produce epoch-based “days ago” text. The QA fixture uses real timestamps, the actual roughin field, and its own empty invoices/payment lists ($650 sample balance).
- The QA bar can wrap at phone widths, its measured height reserves space for role views, and sheet headers/footers no longer shrink into scrolling content. Mobile visual validation remains required.

The focused suite now includes the exact Matte Black → Polished Black sequence, a second later revision, multiple routed trades, escaped change text, financial edge cases, and fixture consistency. These are client/UI checks; they do not establish notification delivery, independent-account synchronization, crew acknowledgement, installation evidence, verification or trusted server enforcement.

## Validation

Run from the repository root:

```sh
npm ci --ignore-scripts
npm run test:loop
node app/subfilter.js
node app/sim.js
npm run preview:build
```

The focused suite exercises the real application in jsdom, mocks the packet persistence boundary, and boots the generated preview with a resource loader that records any external request. It does not substitute for a real Firebase staging test.

The unchanged base simulator reports two failures in this environment: the forward tour has no spotlight at slide 1, and the backward tour misses landmark 14. These remain open; their assertions have not been removed. Legacy selection fixtures now prepare status changes as Builder, preserving homeowner ownership checks. Guest-fixture tests explicitly use preview mode, since a fake token without a server must no longer appear saved. Source-shape checks were adjusted for the extracted packet patch helper; behavioral failure/retry tests are in the focused suite.

Required real-browser sheet-contract, contact-sheet, pixel-tight, and `qa.js` checks have not been run in this Work session. The available browser control path does not support this buildless static checkout's local preview. No pixel baselines were blessed. CI and an appropriate browser-capable development environment must complete these gates before release.

## Remaining work before the full communication loop can pass

1. **Trusted authority and concurrency.** Introduce versioned server commands and authenticated role checks, immutable released revisions, conflict rejection, and an append-only audit store. Current checks are client defenses, not security boundaries. The repository's Firestore rules do not define the packet collection, so inspect and reconcile the actual deployed rules in staging before changing them. Do not deploy the checked-in rules as-is.
2. **Legacy records.** Inventory all existing packet tokens, including older links no longer referenced by a booking. This client update cannot repair orphaned links. Migrate or revoke them explicitly, preserve Q&A, and test mixed old/new clients and service-worker upgrades.
3. **Affected trades.** Add explicit dependencies among decisions, documents and trades. A shower change may affect tile, plumbing and framing; the current category-to-trade mapping does not prove all dependencies were notified.
4. **Notification delivery and acknowledgement.** A prepared link or opened share sheet is not delivery, and date confirmation is not acknowledgement of the current instructions. Add a durable notification outbox, deduplication, provider delivery results and revision-specific acknowledgements for each required recipient. Some legacy scheduling reminders still use the old `pkSent` field; migrate them to truthful delivery states.
5. **Installed and verified.** Add evidence of what was installed, an explicit exception path for work done before approval, and a separate authorized verification step. Existing Installed status remains editable; it is not proof of compliance. A photograph alone must not automatically establish conformity.
6. **Persistence and scale.** Move revision/approval history out of growing client records into append-only server records. Use bounded fingerprints for exact revisions and test Firestore size limits. Prove offline recovery, simultaneous edits, independent-account visibility and notification behavior against a separate staging project.
7. **Experience.** After correctness, simplify the homeowner questions progressively, prepare the builder's decision summary, and make the crew's next action obvious. Preserve comfort, durability, operating-cost and material-efficiency language. Sustainability features should describe practical choices without assumptions about a user's politics.

The acceptance week must include an ordinary shower choice, a late material revision, a dependent trade, a missed notice, an offline phone, a conflicting edit, an installation exception, and separate verification. All three real QA roles must agree on the current authorized revision. Until those pass, this branch is for review and testing only.
