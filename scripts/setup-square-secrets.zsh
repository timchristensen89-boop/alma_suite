#!/usr/bin/env zsh
# Configure the two Alma Square app credential sets without printing secrets.
#
# Usage:
#   zsh scripts/setup-square-secrets.zsh
#
# This script:
#   - prompts for primary/secondary Square app IDs, app secrets, and webhook signature keys
#   - writes each credential to Google Secret Manager
#   - grants the Cloud Run runtime service account access to those secrets
#   - updates alma-compliance-api with secret-backed env vars plus shared Square URLs/labels
#
# It does not deploy source code and it never echoes secret values.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-alma-compliance}"
REGION="${REGION:-australia-southeast1}"
SERVICE_NAME="${SERVICE_NAME:-alma-compliance-api}"
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-433873385316-compute@developer.gserviceaccount.com}"

SQUARE_REDIRECT_URI_DEFAULT="https://alma-compliance-api-433873385316.australia-southeast1.run.app/api/integrations/square/callback"
SQUARE_WEBHOOK_URL_DEFAULT="https://alma-compliance-api-433873385316.australia-southeast1.run.app/api/integrations/square/webhook"
SQUARE_ENVIRONMENT_DEFAULT="production"
SQUARE_API_VERSION_DEFAULT="2025-12-17"
SQUARE_PRIMARY_LABEL_DEFAULT="St Alma"
SQUARE_SECONDARY_LABEL_DEFAULT="Alma Avalon"

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

printf "Square credential setup for project %s, service %s (%s)\n" "$PROJECT_ID" "$SERVICE_NAME" "$REGION"
gcloud config get-value account >/dev/null
gcloud config get-value project >/dev/null

PRIMARY_APP_ID="$(prompt_value "Primary Square application ID")"
PRIMARY_APP_SECRET="$(prompt_secret "Primary Square application secret")"
PRIMARY_WEBHOOK_KEY="$(prompt_secret "Primary Square webhook signature key")"
SECONDARY_APP_ID="$(prompt_value "Secondary Square application ID")"
SECONDARY_APP_SECRET="$(prompt_secret "Secondary Square application secret")"
SECONDARY_WEBHOOK_KEY="$(prompt_secret "Secondary Square webhook signature key")"

PRIMARY_LABEL="$(prompt_value "Primary label [${SQUARE_PRIMARY_LABEL_DEFAULT}]")"
SECONDARY_LABEL="$(prompt_value "Secondary label [${SQUARE_SECONDARY_LABEL_DEFAULT}]")"
SQUARE_REDIRECT_URI="$(prompt_value "Square OAuth redirect URI [${SQUARE_REDIRECT_URI_DEFAULT}]")"
SQUARE_WEBHOOK_URL="$(prompt_value "Square webhook base URL [${SQUARE_WEBHOOK_URL_DEFAULT}]")"
SQUARE_ENVIRONMENT="$(prompt_value "Square environment [${SQUARE_ENVIRONMENT_DEFAULT}]")"
SQUARE_API_VERSION="$(prompt_value "Square API version [${SQUARE_API_VERSION_DEFAULT}]")"

PRIMARY_LABEL="${PRIMARY_LABEL:-$SQUARE_PRIMARY_LABEL_DEFAULT}"
SECONDARY_LABEL="${SECONDARY_LABEL:-$SQUARE_SECONDARY_LABEL_DEFAULT}"
SQUARE_REDIRECT_URI="${SQUARE_REDIRECT_URI:-$SQUARE_REDIRECT_URI_DEFAULT}"
SQUARE_WEBHOOK_URL="${SQUARE_WEBHOOK_URL:-$SQUARE_WEBHOOK_URL_DEFAULT}"
SQUARE_ENVIRONMENT="${SQUARE_ENVIRONMENT:-$SQUARE_ENVIRONMENT_DEFAULT}"
SQUARE_API_VERSION="${SQUARE_API_VERSION:-$SQUARE_API_VERSION_DEFAULT}"

require_value "SQUARE_PRIMARY_APPLICATION_ID" "$PRIMARY_APP_ID"
require_value "SQUARE_PRIMARY_APPLICATION_SECRET" "$PRIMARY_APP_SECRET"
require_value "SQUARE_PRIMARY_WEBHOOK_SIGNATURE_KEY" "$PRIMARY_WEBHOOK_KEY"
require_value "SQUARE_SECONDARY_APPLICATION_ID" "$SECONDARY_APP_ID"
require_value "SQUARE_SECONDARY_APPLICATION_SECRET" "$SECONDARY_APP_SECRET"
require_value "SQUARE_SECONDARY_WEBHOOK_SIGNATURE_KEY" "$SECONDARY_WEBHOOK_KEY"

printf "\nValues captured. Length check only:\n"
printf "  Primary application ID: %d chars\n" "${#PRIMARY_APP_ID}"
printf "  Primary application secret: %d chars\n" "${#PRIMARY_APP_SECRET}"
printf "  Primary webhook signature key: %d chars\n" "${#PRIMARY_WEBHOOK_KEY}"
printf "  Secondary application ID: %d chars\n" "${#SECONDARY_APP_ID}"
printf "  Secondary application secret: %d chars\n" "${#SECONDARY_APP_SECRET}"
printf "  Secondary webhook signature key: %d chars\n" "${#SECONDARY_WEBHOOK_KEY}"
printf "\nCloud Run will be updated with:\n"
printf "  Redirect URI: %s\n" "$SQUARE_REDIRECT_URI"
printf "  Primary webhook: %s/primary\n" "${SQUARE_WEBHOOK_URL%/}"
printf "  Secondary webhook: %s/secondary\n" "${SQUARE_WEBHOOK_URL%/}"
printf "  Labels: %s, %s\n" "$PRIMARY_LABEL" "$SECONDARY_LABEL"
printf "\nType UPDATE to write secrets and update Cloud Run: "
IFS= read -r CONFIRM
if [[ "$CONFIRM" != "UPDATE" ]]; then
  printf "Cancelled. No changes made.\n"
  exit 0
fi

write_secret "SQUARE_PRIMARY_APPLICATION_ID" "$PRIMARY_APP_ID"
write_secret "SQUARE_PRIMARY_APPLICATION_SECRET" "$PRIMARY_APP_SECRET"
write_secret "SQUARE_PRIMARY_WEBHOOK_SIGNATURE_KEY" "$PRIMARY_WEBHOOK_KEY"
write_secret "SQUARE_SECONDARY_APPLICATION_ID" "$SECONDARY_APP_ID"
write_secret "SQUARE_SECONDARY_APPLICATION_SECRET" "$SECONDARY_APP_SECRET"
write_secret "SQUARE_SECONDARY_WEBHOOK_SIGNATURE_KEY" "$SECONDARY_WEBHOOK_KEY"

gcloud run services update "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --update-secrets "SQUARE_PRIMARY_APPLICATION_ID=SQUARE_PRIMARY_APPLICATION_ID:latest,SQUARE_PRIMARY_APPLICATION_SECRET=SQUARE_PRIMARY_APPLICATION_SECRET:latest,SQUARE_PRIMARY_WEBHOOK_SIGNATURE_KEY=SQUARE_PRIMARY_WEBHOOK_SIGNATURE_KEY:latest,SQUARE_SECONDARY_APPLICATION_ID=SQUARE_SECONDARY_APPLICATION_ID:latest,SQUARE_SECONDARY_APPLICATION_SECRET=SQUARE_SECONDARY_APPLICATION_SECRET:latest,SQUARE_SECONDARY_WEBHOOK_SIGNATURE_KEY=SQUARE_SECONDARY_WEBHOOK_SIGNATURE_KEY:latest" \
  --update-env-vars "SQUARE_PRIMARY_LABEL=${PRIMARY_LABEL},SQUARE_SECONDARY_LABEL=${SECONDARY_LABEL},SQUARE_REDIRECT_URI=${SQUARE_REDIRECT_URI},SQUARE_WEBHOOK_URL=${SQUARE_WEBHOOK_URL},SQUARE_ENVIRONMENT=${SQUARE_ENVIRONMENT},SQUARE_API_VERSION=${SQUARE_API_VERSION}" >/dev/null

printf "\nSquare secrets updated for %s.\n" "$SERVICE_NAME"
printf "Configure these URLs in Square Developer Dashboard:\n"
printf "  OAuth redirect: %s\n" "$SQUARE_REDIRECT_URI"
printf "  Primary webhook: %s/primary\n" "${SQUARE_WEBHOOK_URL%/}"
printf "  Secondary webhook: %s/secondary\n" "${SQUARE_WEBHOOK_URL%/}"
