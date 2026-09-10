# Public QA release check — September 10, 2026

## Version 6 release evidence (earlier attempt)

- GitHub review branch: `codex/staging-recovery-appcheck`.
- Implementation commit: `135c4f5c8c9e096aba92a6dac28da4e262c23aba` (verified after branch update).
- Sites version: **6**.
- Sites source commit: `06487d30d89f3b4d222628d3335260ca4aa2c17b` (pushed and read back from HEAD).
- Deployment: `appgdep_6aa309165fd481918b13bc208d10915d` reported **succeeded** at `2026-09-10T19:46:39.665165+00:00`.
- Public URL: https://siteplumb-qa.pmgottschalk.chatgpt.site
- The uploaded archive's app/index.html SHA-256 is `42a28ae5e7221517cf0ed7f6e1d0bb6bff54a0cffbd1ef1579e455c68a688b06`, matching the local published output. It includes `workspace.js` and `workspace.css`.

## Native public-browser result

**Release identity check: FAIL. Dependent public QA checks: NOT RUN.**

The same native Chrome browser used for the internal candidate opened the requested public `/app/?demo=1` URL in a fresh tab. After the page load completed, it rendered the older interface (`Needs you`, the old calendar, and sample items cleared by the redesign). The role toolbar and 42 Sample Lane were present, but the new workspace was absent.

Read-only rendered-document inspection showed:

- Final page URL: `https://siteplumb-qa.pmgottschalk.chatgpt.site/app/`.
- No `data-workspace-version` marker.
- Scripts: `runtime.js`, `qa-crew-checks.js`, `qa-preview.js` — no `workspace.js`.
- Stylesheets: `fonts.css` — no `workspace.css`.

No reload or cache-clearing attempt was made, and dependent approval tests were stopped. This is evidence of an older bundle being delivered to this browser, not proof that the redesigned app failed its approval workflow. The cause of the delivery mismatch is unresolved; do not call it a confirmed CDN or browser-cache issue.

Sites inspection confirms version 6 is latest and the live URL is unchanged. Recent worker error logs were empty. A separate read-only HTTP diagnostic from the development environment was denied with HTTP 403; it was not used as rendered-app test evidence. No alternative billed browser service was used.

The internal native-browser evidence is documented separately in `WORKSPACE-REDESIGN-2026-09-10.md` and must not be presented as a public post-deployment pass. Final workspace unit checks also passed (6/6).

## Version 6 results (preserved)

| Check | Result |
|---|---|
| Public redesigned app identity | FAIL |
| Public seven-step approval/revision scenario | NOT RUN |
| Public acknowledgment, evidence, verification | NOT RUN |
| 390×844 and 430×932 | NOT RUN — no native resize capability |
| Actual iPhone Safari | NOT RUN |

Production SitePlumb and Firebase were untouched. No real messages, invitations, or account connections were made.

## Version 7 — current public preview

The existing Site was republished with an explicit release directory. Use:

https://siteplumb-qa.pmgottschalk.chatgpt.site/workspace-20260910/

- Review branch source commit: `9ae13688f1bee6711225b8d0ef0410ac86166545`.
- Sites source commit: `92b1baec72259f3fbf66a52790870d2e63c47a4e`.
- Sites version: **7**.
- Deployment: `appgdep_6aa30a2a33a4819184038b94f8fb7a34`, succeeded at `2026-09-10T19:51:18.578283+00:00`.
- Native Chrome rendered the new Builder, Homeowner, and Crew workspaces at this exact public path. All role controls and Test steps were interacted with.
- Start over was used once before the recorded core sequence. The sequence then used the same tab and sample session, without reloads. Preliminary state before that reset is excluded from the core evidence.

### Direct public UI results

| Check | Result | Exact visible evidence |
|---|---|---|
| New release identity and sample | PASS | `Keep the build moving.`, `Make it feel like your home.`, `42 Sample Lane`; working Builder/Homeowner/Crew/Test steps controls |
| 1. Homeowner answer and approval | PASS | Entered `Matte Black` into `Finish`, submitted answers, clicked `Approve instructions`; packet then showed `Builder approval pending`, Homeowner `Signed`, `Finish: Matte Black` |
| 2. Builder inspection and actual approval | PASS | Before approval: `Builder approval pending`, Builder `Not signed yet`, Homeowner `Signed by Homeowner`, `Finish: Matte Black`. Clicked actual `Approve instructions`; then `Instructions approved`, `Signed by you`, `Signed by Homeowner` |
| 3. Crew original packet | PASS | `Instructions approved`; Builder `Signed by Demo Builder` / `Signed`; Homeowner `Signed by Homeowner` / `Signed`; `Finish: Matte Black` |
| 4. Actual Finish specification | PASS | Opened `Install spec sheet`, edited the textbox under `Homeowner decides` → `Finish` from `Matte Black` to `Polished Black`, then `Save spec`. No Note edit |
| 5. Exact revision and invalidation | PASS | `Finish: Matte Black → Polished Black`; `Finish: Polished Black`; Crew `Homeowner and builder approval pending`; both roles `Details changed — review again` / `Pending`; `Do not install from these instructions until both approvals are complete.` |
| 6. One homeowner revised approval | PASS | Clicked `Approve changes` once. Crew: `Builder approval pending`; Builder `Pending`; Homeowner `Signed by Homeowner` / `Signed`; explicit do-not-install hold remained |
| 7. Builder revised approval | PASS | Clicked `Approve instructions`. Crew: `Instructions approved`; both roles `Signed`; `Finish: Polished Black` |
| Crew acknowledgment | PASS — sample | Clicked `Acknowledge instructions`; `Instructions acknowledged`; `Record WR-1 · acknowledged by QA Plumbing` |
| Installation note | PASS — sample | Saved a clearly labeled QA installation note; `Ready for independent review`; `Your installation evidence is recorded. The builder reviews it next.` |
| Independent builder verification | PASS — sample | Builder saw the crew note beside `Polished Black` and dimensions, entered a verification note, checked the independent-review confirmation, and clicked `Verify installation`. Builder: `The recorded work is verified.` Crew: `Installation verified`; `Reviewed by Demo Builder. The installation evidence matches these instructions.` |
| Build brief carries context forward | PASS — sample | Homeowner saved `A quiet, comfortable home with durable finishes and simple maintenance.` Builder decision brief showed that exact text; both approvals remained `Signed`, work remained `Installation verified` |
| Current desktop horizontal overflow | PASS — limited | At 1363×936, document clientWidth and scrollWidth both 1363. This does not establish mobile behavior |
| 390×844 and 430×932 | NOT RUN | Native browser has no exposed viewport resizing capability |
| Actual iPhone Safari | NOT RUN | Browser was native cloud Chrome |
| Photo upload | NOT RUN | Note-only installation evidence was exercised |
| Real-account authorization, cross-company/house isolation, notification delivery, offline recovery, separate devices | NOT RUN | Public sample remains local and disconnected from Firebase |

### Screenshot and test limits

Public screenshots were captured throughout the sequence. They are viewport captures, so some lower content is outside the image; corresponding rendered DOM states were read before continuing. The step-2 pre-approval image captured the preceding decision brief (Homeowner Signed / Builder Pending) while the rendered packet text already showed Matte Black and the pending builder signature. It is **not** a complete screenshot of the opened pre-approval packet. The exact pre-approval packet state is supported by direct rendered-DOM inspection and the subsequent actual approval action. This screenshot coverage limitation is retained rather than recreating a historical state.

One public semantic click to open Review packet timed out before opening. Fresh visible-state inspection confirmed it remained unopened; a subsequent click succeeded. Evidence-helper assertions using the wrong sheet selector or the expected wording `Signed by Demo Builder` instead of the actual builder-view `Signed by you` were corrected after visible inspection; they were not treated as product failures or used to fabricate a pass.

The Test steps help text still refers to the former Builder `Needs you` label; the new primary path is `Review decision`. Crew completion is correctly shown as Verified, although its general introductory text still asks the crew to review before starting. These are copy follow-ups, not claims of completed polish.

The version-6 `/app/` delivery mismatch remains an earlier failed release-identity check. Version-7 passes apply only to the verified versioned URL above. No root cause for the older-path delivery mismatch was established.

40 automated checks passed during this implementation pass (34 existing communication-loop checks and 6 workspace checks); the final workspace source also passed its 6 checks. These and the public interactions verify the sample implementation, not deployed server permissions. New build-brief and work-completion persistence is sample-only. Production and Firebase were not changed.
