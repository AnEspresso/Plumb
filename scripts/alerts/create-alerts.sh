#!/usr/bin/env bash
# Creates the two Cloud Monitoring alerts for Plumb's Cloud Functions and emails ALERT_EMAIL.
# Peter runs this once, signed in to gcloud as a project owner. Nothing in CI runs it.
#   ALERT_EMAIL=you@example.com bash scripts/alerts/create-alerts.sh
# Re-running creates duplicates: list first with `gcloud monitoring policies list --project plumb-467a0`.
set -euo pipefail
PROJECT="${PROJECT:-plumb-467a0}"
: "${ALERT_EMAIL:?set ALERT_EMAIL to the address that gets the alerts}"
DIR="$(cd "$(dirname "$0")" && pwd)"

# 1. Email channel (Google sends a confirmation email to ALERT_EMAIL; the alert mails nothing until it is confirmed).
CHANNEL="$(gcloud beta monitoring channels create \
  --project="$PROJECT" \
  --display-name="Plumb alerts email" \
  --type=email \
  --channel-labels=email_address="$ALERT_EMAIL" \
  --format='value(name)')"
echo "channel: $CHANNEL"

# 2. Every ERROR log line from a function (at most one email per 5 minutes).
gcloud monitoring policies create \
  --project="$PROJECT" \
  --policy-from-file="$DIR/log-errors-policy.json" \
  --notification-channels="$CHANNEL"

# 3. Any 5xx from a function in a 5-minute window.
gcloud monitoring policies create \
  --project="$PROJECT" \
  --policy-from-file="$DIR/function-5xx-policy.json" \
  --notification-channels="$CHANNEL"

gcloud monitoring policies list --project="$PROJECT" --format='table(displayName,enabled)'
