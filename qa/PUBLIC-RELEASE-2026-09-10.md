# Public QA release check — September 10, 2026

## Release evidence

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

## Outstanding checks

| Check | Result |
|---|---|
| Public redesigned app identity | FAIL |
| Public seven-step approval/revision scenario | NOT RUN |
| Public acknowledgment, evidence, verification | NOT RUN |
| 390×844 and 430×932 | NOT RUN — no native resize capability |
| Actual iPhone Safari | NOT RUN |

Production SitePlumb and Firebase were untouched. No real messages, invitations, or account connections were made.
