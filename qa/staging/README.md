# Isolated staging reconstruction — September 10, 2026

This is new source reconstructed from the September 9 foundation, connection and startup reports. Their reported commits were absent from the restored repository. This is not an exact recovery, and their historical tests do not qualify this candidate.

The existing app source is unchanged. The build connects its specification sheet and packet review to a bounded authenticated staging backend. Cloud mode accepts only siteplumb-staging and its hosting origin, uses the registered reCAPTCHA Enterprise site key, and requires App Check. Emulator mode accepts only the demo project and loopback services.

Implemented: immutable instruction snapshots, revision-bound signatures, expected-revision transactions, idempotency, approval invalidation, explicit installation holds, house/company/trade checks, staff capabilities, and crew price redaction. Homeowners cannot directly change technical fields; rules allow immutable proposals, but proposal UI and disposition are not implemented.

From this directory, `npm ci` installs locked dependencies and `npm test` runs local Auth/Firestore emulator checks using fake data. `node build.cjs staging` builds an undeployed candidate. Its manifest deliberately says releaseReady: false.

The callable tests exercise the exported onCall middleware through an Express HTTP harness with real Auth emulator tokens. The basic DOM test uses simulated command transport. The SDK integration tests use the actual bundled Firebase Web SDK, real Auth emulator sign-in, and the actual callable middleware/Firestore emulator through the existing spec sheet and approval footer in JSDOM. They verify the revision sequence, account clearing, and revoked membership. The harness supplies browser fetch globals and an Origin header. None of these tests is a rendered native-browser test or qualification of Google's managed Functions runtime.

Release preparation is in `release/RELEASE-PLAN.md`: proposed runtime roles, 12 fake identities, three houses, a collision-refusing provisioner, and maintenance/deny-all rollback materials. The build now includes a dedicated runtime dependency lock. Nothing has been applied in the cloud. A fresh read-only preflight, complete baseline snapshots and reviewed deployment permissions are still required before release, followed by native-browser hosted App Check/sign-in/revision checks. The local SDK-to-callable sequence has passed; actual browser loading, CORS enforcement, layout and cloud App Check remain unverified.

No service account, IAM grant, cloud fixture or deployment is created by these files. Existing cloud deny-all rules remain untouched. Production remains untouched.

Unimplemented or unproven: acknowledgments, installation evidence, independent verification, notification delivery, withdrawal, proposal disposition, continuous refresh, legacy bearer-link migration, separate devices and Safari. The authenticated API resolves old revision IDs to current instructions with a superseded flag; this does not establish that public crew links have been migrated.

Offline clears displayed instructions and requires refresh. A failed save preserves the unsent form, which still needs reconciliation after loading current instructions.

The owner has authorized automatic review-branch uploads and QA/staging deployments; no further “release” prompt is required for those destinations. Each QA/staging release still requires the planned verification and native-browser checks. Production remains outside this authorization. This reconstruction has not been released.
