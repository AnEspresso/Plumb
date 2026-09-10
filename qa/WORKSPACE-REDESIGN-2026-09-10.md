# SitePlumb workspace redesign

Built on `codex/staging-recovery-appcheck`, preserving the existing vanilla app, editors, approval logic, and guest-link safeguards.

## Working preview

- Builder workspace prioritizes the next decision, its owner, the affected packet, upcoming work, and recent progress.
- Homeowner workspace starts with the unanswered question or current approval; costs and project records remain available.
- Crew workspace starts with its current scope, approved instructions or an explicit do-not-install hold.
- A build brief records homeowner priorities, appearance preferences, and budget tradeoffs without silently changing installation specifications.
- Decision briefs assemble the current approval states, recorded selection cost, scheduled work, homeowner priorities, and exact revision changes.
- Sample crew acknowledgment, installation notes, optional image evidence, and independent builder verification are bound to the full canonical instruction key. Changed instructions supersede earlier records; withdrawn approvals block installation. Recorded instruction/approval snapshots are retained.
- The public sample bundle is forced local, strips Firebase SDKs, and restricts network destinations with a Content Security Policy. It sends no messages.

## Evidence from native Chrome on the internal candidate preview

Direct UI interaction on 2026-09-10, one browser tab and continuous sample session after the initial render fix. Screenshots captured before continuing at each checkpoint.

| Check | Result | Exact visible evidence |
|---|---|---|
| Homeowner answer and approval | PASS | `Finish: Matte Black`; after approval `Builder approval pending`; Homeowner `Signed` |
| Builder inspection before approval | PASS | `Finish: Matte Black`; Homeowner `Signed`; Builder `Not signed yet`; actual `Approve instructions` action used |
| Crew initial authorized instructions | PASS | `Instructions approved`; both roles `Signed`; `Finish: Matte Black` |
| Actual specification editor | PASS | `Install spec sheet` → `Homeowner decides` → `Finish`, edited to `Polished Black`; `Save spec` used |
| Revision invalidation | PASS | `Finish: Matte Black → Polished Black`; `Homeowner and builder approval pending`; both `Pending`; `Do not install from these instructions until both approvals are complete.` |
| Homeowner revised approval | PASS | `Approve changes` submitted once; Crew `Builder approval pending`, Homeowner `Signed`, Builder `Pending`; hold remains |
| Builder revised approval | PASS | Crew `Instructions approved`; both `Signed`; `Finish: Polished Black` |
| Crew acknowledgment | PASS | `Instructions acknowledged`; `Record WR-1 · acknowledged by QA Plumbing` |
| Installation note handoff | PASS | `Ready for independent review`; crew note visible to the builder beside the approved finish and dimensions |
| Independent sample verification | PASS | Builder checked the confirmation, added a review note, and submitted `Verify installation`; packet row became `Verified` |
| 390×844 / 430×932 | NOT RUN | Native browser exposes no viewport resizing capability |
| Actual iPhone/Safari | NOT RUN | Native browser was Chrome |
| Photo upload | NOT RUN | Installation-note flow tested; no browser photo upload performed |

Three semantic click attempts timed out before submitting. Fresh visible-state inspection confirmed the action had not occurred; the current control was then used successfully. No approval was inferred from page text alone. Browser screenshots were captured for the completed checkpoints.

Final cleanup corrects a stale builder summary after saving a specification, removes the old duplicate house summary, and corrects the crew’s post-verification explanation. Publication checks are recorded separately after release.

## Scope of verification

40 automated checks passed, including the existing 34 communication-loop checks and 6 workspace checks. These exercise sample data and client behavior. They do not establish deployed server authorization.

This is a usable sample redesign, not a claim that the full product vision is production-ready. The new brief and completion tools are sample-only; the staging adapter does not expose the sample completion path. Server/database enforcement and durable storage for these additions, real notifications, cross-company/house isolation under real accounts, offline recovery, separate devices, photo upload validation in a live browser, and actual Safari remain unproven. Existing staging services are preserved and were not deployed in this pass.
