# Function alerts

**Status: Peter to do.** The repo has the alert definitions; nothing creates them automatically, and CI never runs gcloud.

## What gets logged
- Every HTTP function that answers 500 first writes one JSON line through `functions/lib/logError.js`:
  `{"severity":"ERROR","message":"plumb function error","fn":"deleteAccount","error":"…"}` (ids and error text only; no tokens, emails or request bodies).
- An event trigger that throws is logged at ERROR by the runtime, and its delivery counts as a 5xx.
- `onRecordDeleted` already logs `severity: ERROR` when a file delete fails.

## Create the alerts (once)
Signed in to gcloud as a project owner:

```sh
ALERT_EMAIL=you@example.com bash scripts/alerts/create-alerts.sh
```

That runs, in order:

```sh
gcloud beta monitoring channels create --project=plumb-467a0 --display-name="Plumb alerts email" \
  --type=email --channel-labels=email_address="$ALERT_EMAIL" --format='value(name)'
gcloud monitoring policies create --project=plumb-467a0 \
  --policy-from-file=scripts/alerts/log-errors-policy.json --notification-channels="$CHANNEL"
gcloud monitoring policies create --project=plumb-467a0 \
  --policy-from-file=scripts/alerts/function-5xx-policy.json --notification-channels="$CHANNEL"
```

1. **Plumb functions: ERROR log**: a log-match alert on
   `resource.type=("cloud_run_revision" OR "cloud_function") AND severity>=ERROR`, at most one email per 5 minutes.
2. **Plumb functions: failing requests (5xx)**: any `run.googleapis.com/request_count` with `response_code_class = "5xx"` in a 5-minute window, per function.

Confirm the verification email Google sends to `ALERT_EMAIL`, or no alert is delivered.

## Check it works
1. Logs Explorer, project plumb-467a0, filter `jsonPayload.message="plumb function error"`. Real failures show up here.
2. Monitoring → Alerting lists both policies as enabled, with the email channel attached.
3. To test without touching data, open a policy, use **Test notification** (or temporarily set the 5xx threshold), and confirm the email arrives.

To find a failure: Logs Explorer with `severity>=ERROR AND resource.type="cloud_run_revision"`. The `fn` field names the function.
