# Fresh verification — September 10, 2026

Candidate reconstructed from saved specifications, based on fc338dc. No cloud deployment or production modification.

| Check | Result | Evidence boundary |
|---|---|---|
| Staging isolation configuration | PASS | Production and mixed emulator targets rejected locally |
| House, trade and company access | PASS | Firestore emulator service requests |
| Approval/revision sequence | PASS | Matte Black → Polished Black; exact Finish history, Note preserved, both signatures invalidated, single signature retains hold, both signatures approve current revision |
| Immutable history/idempotency/stale revision | PASS | Emulator assertions; old snapshot unchanged and stale signature rejected |
| Staff capabilities and homeowner technical ownership | PASS | Unauthorized commands rejected |
| Database rules and proposals | PASS | Direct authoritative writes, crew reads and forged/updated proposals denied |
| Concurrent specifications | PASS | Exactly one competing edit succeeds |
| Callable authentication/origin/disabled account | PASS | Exported Firebase callable middleware, Express harness, Auth emulator tokens |
| Existing spec-sheet bridge | PASS | JSDOM with simulated transport: Finish payload, Note preserved, hold visible, offline clear |
| Existing approval-loop regressions | PASS | 34/34 existing tests on Node 24.19.0 |
| Reconstructed staging suite | PASS | 11/11 tests on Node 22.23.2; Auth and Firestore emulators; latest integration follow-up |
| Cloud candidate build | PASS | Undeployed output targets siteplumb-staging and registered App Check key |
| Local Web SDK integration | PASS | Actual bundled SDK sign-in → discovery → packet → Finish answers → signatures → Polished Black revision → hold → reapproval, using JSDOM and local emulators |
| Account switch / revoked membership | PASS | Sign-out clears packet; revoked crew membership clears previously approved instructions on refresh |
| Rendered browser SDK integration | NOT RUN | Browser loading, browser-enforced CORS, layout and hosted App Check are not established by JSDOM |
| Managed Functions runtime, hosted App Check issuance | NOT RUN | No deployment |
| Native-browser sample post-release checks | NOT RUN | No new public release |
| Mobile viewport and actual Safari | NOT RUN | No browser/device test performed |

The first callable harness attempt failed because raw Node HTTP requests lack the Express request interface expected by Firebase middleware. The corrected harness uses Express; the final Node 22 run passed. No backend behavior was bypassed to make this pass.

These results do not replace historical direct native-browser evidence from the existing public sample. The new candidate remains releaseReady: false. Remaining cloud setup, full integration and rollback requirements are listed in README.md.

The SDK follow-up found a visible status mismatch: the builder row retained “Sign” after its legacy inline action was removed. The staging adapter now displays the server's “Pending” status and removes the inactive row arrow. The actual approval remains in the footer. The stricter integration assertion passes in the final 11-test run. No source under app/ was changed by this follow-up.
