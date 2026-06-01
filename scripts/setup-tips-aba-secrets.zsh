#!/usr/bin/env zsh
# Configure ABA Direct Entry settings for approved tips exports without
# printing bank details.
#
# Usage:
#   zsh scripts/setup-tips-aba-secrets.zsh
#
# This writes the ABA settings to Google Secret Manager, grants the Cloud Run
# runtime service account read access, and updates alma-compliance-api with
# secret-backed env vars. It does not deploy source code.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-alma-compliance}"
REGION="${REGION:-australia-southeast1}"
SERVICE_NAME="${SERVICE_NAME:-alma-compliance-api}"
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-433873385316-compute@developer.gserviceaccount.com}"

prompt_value() {
  local label="$1"
  local value=""
  printf "%s: " "$label"
  IFS= read -r value
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

printf "Tips ABA setup for project %s, service %s (%s)\n" "$PROJECT_ID" "$SERVICE_NAME" "$REGION"
gcloud config get-value account >/dev/null
gcloud config get-value project >/dev/null

TIPS_ABA_FINANCIAL_INSTITUTION="$(prompt_value "Financial institution abbreviation, e.g. NAB/WBC/CBA")"
TIPS_ABA_USER_NAME="$(prompt_value "Direct Entry user name")"
TIPS_ABA_USER_ID="$(prompt_value "Direct Entry/APCA user ID, 6 digits")"
TIPS_ABA_DESCRIPTION="$(prompt_value "Payment description [ALMA TIPS]")"
TIPS_ABA_DESCRIPTION="${TIPS_ABA_DESCRIPTION:-ALMA TIPS}"
TIPS_ABA_REMITTER_NAME="$(prompt_value "Remitter name")"
TIPS_ABA_TRACE_BSB="$(prompt_value "Trace BSB, 6 digits")"
TIPS_ABA_TRACE_ACCOUNT="$(prompt_value "Trace account number")"

require_value "TIPS_ABA_FINANCIAL_INSTITUTION" "$TIPS_ABA_FINANCIAL_INSTITUTION"
require_value "TIPS_ABA_USER_NAME" "$TIPS_ABA_USER_NAME"
require_value "TIPS_ABA_USER_ID" "$TIPS_ABA_USER_ID"
require_value "TIPS_ABA_REMITTER_NAME" "$TIPS_ABA_REMITTER_NAME"
require_value "TIPS_ABA_TRACE_BSB" "$TIPS_ABA_TRACE_BSB"
require_value "TIPS_ABA_TRACE_ACCOUNT" "$TIPS_ABA_TRACE_ACCOUNT"

printf "\nValues captured. Length check only:\n"
printf "  Institution: %d chars\n" "${#TIPS_ABA_FINANCIAL_INSTITUTION}"
printf "  User name: %d chars\n" "${#TIPS_ABA_USER_NAME}"
printf "  User ID: %d chars\n" "${#TIPS_ABA_USER_ID}"
printf "  Description: %d chars\n" "${#TIPS_ABA_DESCRIPTION}"
printf "  Remitter: %d chars\n" "${#TIPS_ABA_REMITTER_NAME}"
printf "  Trace BSB: %d chars\n" "${#TIPS_ABA_TRACE_BSB}"
printf "  Trace account: %d chars\n" "${#TIPS_ABA_TRACE_ACCOUNT}"
printf "\nType UPDATE to write secrets and update Cloud Run: "
IFS= read -r CONFIRM
if [[ "$CONFIRM" != "UPDATE" ]]; then
  printf "Cancelled. No changes made.\n"
  exit 0
fi

write_secret "TIPS_ABA_FINANCIAL_INSTITUTION" "$TIPS_ABA_FINANCIAL_INSTITUTION"
write_secret "TIPS_ABA_USER_NAME" "$TIPS_ABA_USER_NAME"
write_secret "TIPS_ABA_USER_ID" "$TIPS_ABA_USER_ID"
write_secret "TIPS_ABA_DESCRIPTION" "$TIPS_ABA_DESCRIPTION"
write_secret "TIPS_ABA_REMITTER_NAME" "$TIPS_ABA_REMITTER_NAME"
write_secret "TIPS_ABA_TRACE_BSB" "$TIPS_ABA_TRACE_BSB"
write_secret "TIPS_ABA_TRACE_ACCOUNT" "$TIPS_ABA_TRACE_ACCOUNT"

gcloud run services update "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --update-secrets "TIPS_ABA_FINANCIAL_INSTITUTION=TIPS_ABA_FINANCIAL_INSTITUTION:latest,TIPS_ABA_USER_NAME=TIPS_ABA_USER_NAME:latest,TIPS_ABA_USER_ID=TIPS_ABA_USER_ID:latest,TIPS_ABA_DESCRIPTION=TIPS_ABA_DESCRIPTION:latest,TIPS_ABA_REMITTER_NAME=TIPS_ABA_REMITTER_NAME:latest,TIPS_ABA_TRACE_BSB=TIPS_ABA_TRACE_BSB:latest,TIPS_ABA_TRACE_ACCOUNT=TIPS_ABA_TRACE_ACCOUNT:latest"

printf "\nDone. Approved tips ABA export will work after Cloud Run has rolled the new revision.\n"
