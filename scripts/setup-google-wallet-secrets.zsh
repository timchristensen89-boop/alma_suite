#!/usr/bin/env zsh
# Configure Google Wallet gift-card credentials from the service-account key
# file, without printing private key material and without touching Apple.
#
# Usage:
#   zsh scripts/setup-google-wallet-secrets.zsh
#
# You need two things before running it:
#   1. Your Issuer ID from https://pay.google.com/business/console
#   2. The service-account key JSON downloaded from Google Cloud Console
#      (IAM & Admin -> Service Accounts -> Keys -> Add key -> JSON),
#      with that service account invited as a user on the Wallet console.
#
# The client_email and private_key are extracted from the file here, so this
# works with the currently deployed API as well as builds that accept
# GOOGLE_WALLET_SERVICE_ACCOUNT_JSON directly. Writes to Google Secret
# Manager, grants the Cloud Run runtime account read access, and updates
# alma-compliance-api with secret-backed env vars. It does not deploy code.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-alma-compliance}"
REGION="${REGION:-australia-southeast1}"
SERVICE_NAME="${SERVICE_NAME:-alma-compliance-api}"
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-433873385316-compute@developer.gserviceaccount.com}"
GOOGLE_WALLET_ORIGINS_DEFAULT="${GOOGLE_WALLET_ORIGINS_DEFAULT:-https://alma-giftcards.web.app,https://www.almagroup.com.au}"

prompt_value() {
  local label="$1"
  local value=""
  printf "%s: " "$label" >&2
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
  gcloud secrets describe "$1" --project "$PROJECT_ID" >/dev/null 2>&1
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

printf "Google Wallet setup for project %s, service %s (%s)\n" "$PROJECT_ID" "$SERVICE_NAME" "$REGION"
gcloud config get-value account >/dev/null

GOOGLE_WALLET_ISSUER_ID="$(prompt_value "Google Wallet issuer ID")"
KEY_FILE="$(prompt_value "Path to the downloaded service-account key JSON (e.g. ~/Downloads/alma-wallet-1a2b3c.json)")"
KEY_FILE="${KEY_FILE/#\~/$HOME}"
GOOGLE_WALLET_ORIGINS="$(prompt_value "Allowed origins [${GOOGLE_WALLET_ORIGINS_DEFAULT}]")"
GOOGLE_WALLET_ORIGINS="${GOOGLE_WALLET_ORIGINS:-$GOOGLE_WALLET_ORIGINS_DEFAULT}"

require_value "GOOGLE_WALLET_ISSUER_ID" "$GOOGLE_WALLET_ISSUER_ID"
if [[ ! -f "$KEY_FILE" ]]; then
  printf "Key file not found: %s\n" "$KEY_FILE" >&2
  exit 1
fi

# gcloud itself runs on python3, so it is safe to lean on here.
GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("client_email",""))' "$KEY_FILE")"
GOOGLE_WALLET_PRIVATE_KEY="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("private_key",""))' "$KEY_FILE")"
require_value "client_email in key file" "$GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL"
require_value "private_key in key file" "$GOOGLE_WALLET_PRIVATE_KEY"

printf "\nValues captured. Nothing secret is printed:\n"
printf "  Issuer ID: %s\n" "$GOOGLE_WALLET_ISSUER_ID"
printf "  Service account: %s\n" "$GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL"
printf "  Private key: %d chars\n" "${#GOOGLE_WALLET_PRIVATE_KEY}"
printf "  Origins: %s\n" "$GOOGLE_WALLET_ORIGINS"
printf "\nReminder: %s must be invited as a user on the Wallet console (Users page) or passes will not save.\n" "$GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL"
printf "\nType UPDATE to write secrets and update Cloud Run: "
IFS= read -r CONFIRM
if [[ "$CONFIRM" != "UPDATE" ]]; then
  printf "Cancelled. No changes made.\n"
  exit 0
fi

write_secret "GOOGLE_WALLET_ISSUER_ID" "$GOOGLE_WALLET_ISSUER_ID"
write_secret "GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL" "$GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL"
write_secret "GOOGLE_WALLET_PRIVATE_KEY" "$GOOGLE_WALLET_PRIVATE_KEY"

gcloud run services update "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --update-secrets "GOOGLE_WALLET_ISSUER_ID=GOOGLE_WALLET_ISSUER_ID:latest,GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL=GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL:latest,GOOGLE_WALLET_PRIVATE_KEY=GOOGLE_WALLET_PRIVATE_KEY:latest" \
  --update-env-vars "GOOGLE_WALLET_ORIGINS=${GOOGLE_WALLET_ORIGINS},GOOGLE_WALLET_CLASS_SUFFIX=alma_gift_card"

printf "\nDone. The Add to Google Wallet buttons appear once Cloud Run rolls the new revision.\n"
