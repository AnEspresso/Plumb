# Staging release preparation — September 10, 2026

Prepared for review. No cloud action in this plan has been performed. The release target is **siteplumb-staging**, project number **625071693246**, hosting origin **https://siteplumb-staging.web.app**, Firestore `(default)` in `us-central1`. Production `plumb-467a0` and the existing public sample Site are outside this release.

## Exact proposed scope

After the owner says **release**, perform a fresh read-only preflight and review its results before mutations. Use the existing owner Cloud Shell session; no new human account access, service-account key, repository secret, invitation or outgoing email is needed. Confirm that the saved code revision is the approved revision before installing its locked dependencies.

The proposed first staging release creates one dedicated runtime account, grants its two staging-scoped roles, creates the 12 fake identities and three houses below, deploys one callable endpoint plus the staging rules and static frontend, and runs native-browser hosted checks. Cloud API activation or deployment-identity changes must be itemized from the preflight before proceeding; do not grant broad roles to fix an unexplained denial.

## Permissions

| Identity | Proposed access | Purpose / boundary |
|---|---|---|
| Existing owner in Cloud Shell | Existing staging owner access; no additional grant | One-time setup and deployment; the actual active identity must be checked locally before use |
| `siteplumb-packets@siteplumb-staging.iam.gserviceaccount.com` | `roles/datastore.user` on staging only | Transactional reads/writes of staging Firestore data; this is project-wide data access, not collection-scoped |
| Same runtime account | `roles/firebaseauth.viewer` on staging only | Check current user and disabled/revoked status; no account creation or email permission |
| Firebase test identities | No Google Cloud IAM roles | App membership documents and callable authorization govern access |
| Callable HTTP endpoint | Public network invocation on the one service if required by SDK calls | Application access still requires Firebase Auth, App Check, exact origin and per-command house/company/trade authorization; never grant project-wide invocation |

The [Firestore role reference](https://docs.cloud.google.com/iam/docs/roles-permissions/firestore) describes the database role. The [Authentication role reference](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth) lists the viewer permissions. Runtime Admin SDK access bypasses Firestore client rules, so the service's authorization checks are essential.

Review-time commands, **not yet executed**:

```sh
gcloud projects describe siteplumb-staging --format='value(projectId,projectNumber,lifecycleState)'
gcloud iam service-accounts create siteplumb-packets --project=siteplumb-staging --display-name='SitePlumb staging packet runtime'
gcloud projects add-iam-policy-binding siteplumb-staging --member='serviceAccount:siteplumb-packets@siteplumb-staging.iam.gserviceaccount.com' --role='roles/datastore.user'
gcloud projects add-iam-policy-binding siteplumb-staging --member='serviceAccount:siteplumb-packets@siteplumb-staging.iam.gserviceaccount.com' --role='roles/firebaseauth.viewer'
```

If the account exists, inspect its current bindings rather than recreating it. Capture the staging IAM policy before and after any approved grant. Firebase/Google-managed service agents retain their platform roles; these roles must not be assigned to the runtime account. Build/deployer identity and any required service-account `actAs` permission remain subject to the live preflight, since no current IAM inventory is available here. The official [functions IAM guide](https://docs.cloud.google.com/functions/docs/concepts/iam) distinguishes deployment and runtime access.

## Fake accounts and data

`fixtures.cjs` defines two companies, three houses, three Plumbing packets and 12 identities. All email addresses use the reserved `.example` domain; no messages are sent. Passwords are generated only when provisioning runs, written once to a private owner-local file, and never committed or printed.

| Fake identity | Assigned scope | Expected behavior |
|---|---|---|
| `qa_owner` / `qa_gc` | Company A, 42 Sample Lane | Specify and approve as builder |
| `qa_homeowner` | 42 Sample Lane | Answer Finish and approve; technical edits denied |
| `qa_pm` | 42 Sample Lane, specify/approve capabilities | Authorized builder actions |
| `qa_employee` | 42 Sample Lane, no command capabilities | Read; specification/approval commands denied |
| `qa_crew` | 42 Sample Lane, Plumbing | Redacted current packet; approval commands denied |
| `qa_wrong_trade` | 42 Sample Lane, Electrical | Plumbing access denied despite discovery index entry |
| `qa_revoked` | Inactive company membership | Access denied despite house assignment |
| `qa_disabled` | Disabled Auth account | Sign-in denied |
| `qa_other_house` | Company A, 44 Sample Lane | No access to 42 Sample Lane |
| `qa_other_company` | Company B, 90 Other Sample Road | No Company A access |
| `qa_unassigned` | None | No assigned packets; guessed packet access denied |

All packets start with no signatures, a filled builder Rough-in and unanswered homeowner Finish. The Note is fixed for the Matte Black → Polished Black regression. Documents and bookings are deliberately empty; this fixture does not qualify their editing or evidence flows.

From `qa/staging`, the preparation command is harmless and local:

```sh
node release/provision.cjs --plan
```

Only after release approval and project identity verification, the reviewed apply form is:

```sh
node release/provision.cjs --apply siteplumb-staging --credentials-out /home/pmgottschalk/siteplumb-staging-test-credentials.json
```

The output path must be outside the checkout and absent before execution. The script verifies the project ID, number and active state through Google's API before initializing the SDK. It refuses any existing fixture UID, email or document, creates accounts disabled, atomically creates the fixture documents, then enables all except the deliberately disabled account. If an operation fails, it attempts to disable every account it created and reports cleanup failures. Auth and Firestore do not provide a shared transaction: a partial failure requires inspection; do not rerun or delete accounts blindly. Credentials are mode 0600 and must remain private.

## Before deployment

Record, without changing them: billing status and budget scope; default database identity; current rules source/hash; existing Hosting release/version or confirmed absence; callable source/runtime/service identity and service IAM or confirmed absence; staging Auth provider; App Check registration and allowed domain; enabled APIs; deployer/build/runtime identity permissions. Do not treat earlier console observations as a fresh inventory. Keep snapshots owner-local, outside the repository, without access tokens.

The runtime remains Node 22, 256 MiB, minimum zero/maximum one instance and 30-second timeout. The [$5 budget is an alert, not an enforcement mechanism](https://cloud.google.com/billing/docs/how-to/budgets); instance limits are not a dollar cap. [Firebase's runtime guide](https://firebase.google.com/docs/functions/manage-functions) explains these options. Keep deployment-artifact retention bounded after inspecting existing policy.

Build using the locked files; `build.cjs staging` copies the dedicated runtime package lock into the deploy output. Record the source tree hash, dependency lock hashes, output hashes and operator for this release. The candidate remains `releaseReady: false` until the live preflight and rollback records have been reviewed. Preparation alone does not change that flag.

The review sequence is: retain deny-all client rules while setting up fixtures; deploy the protected callable and check unauthenticated/wrong-origin rejection; then deploy the reviewed rules and static frontend to staging. Use explicit `--project siteplumb-staging`, the candidate's absolute `--config` path, and only the staging codebase, Firestore rules and staging Hosting site. Never run an unscoped root `firebase deploy`.

## Rollback and stop conditions

Stop at the first failed dependent approval, access or App Check checkpoint. Capture the exact result. Do not mark hosted checks passed from local results.

1. Restrict invocation of the staging callable service so new commands cannot run. Discover the precise Cloud Run service from `gcloud functions describe packetCommand --gen2 --region=us-central1 --project=siteplumb-staging`; inspect its IAM policy and remove the invocation grants recorded in this release only. Verify an attempted command is denied. Do not assume changing Firestore rules stops Admin SDK calls.
2. Deploy the prepared `release/rollback` maintenance page and deny-all rules using its config and explicit staging project. The page has no scripts or network calls and explicitly says do not install. If a verified prior Hosting release exists, it may instead be restored through [Hosting release history](https://firebase.google.com/docs/hosting/manage-hosting-resources).
3. Preserve all revision, approval and command documents. Do not roll back the database to an old snapshot, move current revision pointers backwards, or manufacture signatures. Restore a previous function only from an archived, reviewed source package known to support the retained data; otherwise leave staging paused.
4. Firestore rules must be redeployed from the recorded previous source; a Hosting rollback does not restore rules or functions. Firebase documents this separation in the [CLI reference](https://firebase.google.com/docs/cli).
5. Verify new sessions show maintenance or denied access and cannot retrieve current instructions. Already-open tabs are not remotely erased by this release: continuous refresh is unimplemented. Close those test sessions and record this limitation; do not claim instant revocation of already-rendered content.

For the first release, there may be no previous function or Hosting version. The maintenance/deny-access state is the fallback. A cloud rollback rehearsal is **NOT RUN** until the staging deployment exists.

## Post-release acceptance

Use only the native browser. First verify rendered interaction, then run the seven-step Finish approval/revision sequence, including exact Finish history and explicit holds. Capture screenshots at checkpoints. Separately exercise each fake identity's permission boundary, direct client-write rejection, current App Check issuance, disabled/revoked access and wrong-origin rejection. Test 390×844 and 430×932 only if resizing is supported; actual iPhone Safari remains separate. No real notifications, installations or production work occur.

This Firebase staging release does not update the public sample URL. Any future public sample release retains its own release approval and mandatory native-browser checks.
