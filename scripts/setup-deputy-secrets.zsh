#!/usr/bin/env zsh
# Configure Deputy OAuth credentials without printing secrets.
#
# Usage:
#   zsh scripts/setup-deputy-secrets.zsh
#
# This script:
#   - prompts for the Deputy client ID + client secret
#   - writes both to Google Secret Manager
#   - grants the Cloud Run runtime service account read access
#   - updates alma-compliance-api with the secret-backed env vars and the
#     redirect URL
#
# It does not deploy source code and it never echoes secret values.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-alma-compliance}"
REGION="${REGION:-australia-southeast1}"
SERVICE_NAME="${SERVICE_NAME:-alma-compliance-api}"
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-433873385316-compute@developer.gserviceaccount.com}"

DEPUTY_REDIRECT_URL_DEFAULT="https://alma-compliance-api-433873385316.australia-southeast1.run.app/api/integrations/deputy/callback"

restore_tty() {
  stty echo 2>/dev/null || true
}
trap restore_tty EXIT INT TERM

prompt_value() {
  local label="$1"
  local value=""
  printf "%s: " "$label"
  IFS= read -r value
  printf "%s" "$value"
}

prompt_secret() {
  local label="$1"
  local value=""
  printf "%s: " "$label"
  stty -echo
  IFS= read -r value
  stty echo
  printf "\n"
  printf "%s" "$value"
}

require_value() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    printf "Missing required value: %s\n" "$name" >&2
    exit 1
  fi
}

secret_exists() {
  local name="$1"
  gcloud secrets describe "$name" --project "$PROJECT_ID" >/dev/null 2>&1
}

write_secret() {
  local name="$1"
  local value="$2"
  require_value "$name" "$value"

  if secret_exists "$name"; then
    printf "%s" "$value" | gcloud secrets versions add "$name" \
      --project "$PROJECT_ID" \
      --data-file=- >/dev/null
  else
    printf "%s" "$value" | gcloud secrets create "$name" \
      --project "$PROJECT_ID" \
      --replication-policy=automatic \
      --data-file=- >/dev/null
  fi

  gcloud secrets add-iam-policy-binding "$name" \
    --project "$PROJECT_ID" \
    --member="serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
}

printf "Deputy credential setup for project %s, service %s (%s)\n" "$PROJECT_ID" "$SERVICE_NAME" "$REGION"
gcloud config get-value account >/dev/null
gcloud config get-value project >/dev/null

DEPUTY_CLIENT_ID="$(prompt_value "Deputy client ID")"
DEPUTY_CLIENT_SECRET="$(prompt_secret "Deputy client secret")"
DEPUTY_WEBHOOK_SECRET="$(prompt_secret "Deputy webhook secret (leave blank to skip)")"
DEPUTY_REDIRECT_URL="$(prompt_value "Deputy OAuth redirect URL [${DEPUTY_REDIRECT_URL_DEFAULT}]")"

DEPUTY_REDIRECT_URL="${DEPUTY_REDIRECT_URL:-$DEPUTY_REDIRECT_URL_DEFAULT}"

require_value "DEPUTY_CLIENT_ID" "$DEPUTY_CLIENT_ID"
require_value "DEPUTY_CLIENT_SECRET" "$DEPUTY_CLIENT_SECRET"

printf "\nValues captured. Length check only:\n"
printf "  Client ID: %d chars\n" "${#DEPUTY_CLIENT_ID}"
printf "  Client secret: %d chars\n" "${#DEPUTY_CLIENT_SECRET}"
printf "  Webhook secret: %d chars\n" "${#DEPUTY_WEBHOOK_SECRET}"
printf "\nCloud Run will be updated with:\n"
printf "  Redirect URL: %s\n" "$DEPUTY_REDIRECT_URL"
printf "\nType UPDATE to write secrets and update Cloud Run: "
IFS= read -r CONFIRM
if [[ "$CONFIRM" != "UPDATE" ]]; then
  printf "Cancelled. No changes made.\n"
  exit 0
fi

write_secret "DEPUTY_CLIENT_ID" "$DEPUTY_CLIENT_ID"
write_secret "DEPUTY_CLIENT_SECRET" "$DEPUTY_CLIENT_SECRET"

SECRETS_FLAG="DEPUTY_CLIENT_ID=DEPUTY_CLIENT_ID:latest,DEPUTY_CLIENT_SECRET=DEPUTY_CLIENT_SECRET:latest"
if [[ -n "$DEPUTY_WEBHOOK_SECRET" ]]; then
  write_secret "DEPUTY_WEBHOOK_SECRET" "$DEPUTY_WEBHOOK_SECRET"
  SECRETS_FLAG="${SECRETS_FLAG},DEPUTY_WEBHOOK_SECRET=DEPUTY_WEBHOOK_SECRET:latest"
fi

gcloud run services update "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --update-secrets "$SECRETS_FLAG" \
  --update-env-vars "DEPUTY_REDIRECT_URL=${DEPUTY_REDIRECT_URL}" >/dev/null

printf "\nDeputy secrets updated for %s.\n" "$SERVICE_NAME"
printf "Confirm the same URLs are registered on the Deputy developer app:\n"
printf "  OAuth redirect: %s\n" "$DEPUTY_REDIRECT_URL"
printf "  Webhook delivery: %s\n" "${DEPUTY_REDIRECT_URL%/api/integrations/deputy/callback}/api/integrations/deputy/webhook"
