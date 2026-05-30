#!/usr/bin/env zsh
# Configure Apple Wallet and Google Wallet gift-card credentials without
# printing private key material.
#
# Usage:
#   zsh scripts/setup-gift-card-wallet-secrets.zsh
#
# This writes the wallet credentials to Google Secret Manager, grants the Cloud
# Run runtime service account read access, and updates alma-compliance-api with
# secret-backed env vars. It does not deploy source code.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-alma-compliance}"
REGION="${REGION:-australia-southeast1}"
SERVICE_NAME="${SERVICE_NAME:-alma-compliance-api}"
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-433873385316-compute@developer.gserviceaccount.com}"
GOOGLE_WALLET_ORIGINS_DEFAULT="${GOOGLE_WALLET_ORIGINS_DEFAULT:-https://alma-giftcards.web.app,https://www.almagroup.com.au}"

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

prompt_secret_multiline() {
  local label="$1"
  local value=""
  local line=""
  printf "%s\n" "$label"
  printf "Paste the value, then enter a line containing only END:\n"
  while IFS= read -r line; do
    [[ "$line" == "END" ]] && break
    value+="${line}\n"
  done
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

printf "Gift-card wallet setup for project %s, service %s (%s)\n" "$PROJECT_ID" "$SERVICE_NAME" "$REGION"
gcloud config get-value account >/dev/null
gcloud config get-value project >/dev/null

APPLE_WALLET_PASS_TYPE_IDENTIFIER="$(prompt_value "Apple pass type identifier")"
APPLE_WALLET_TEAM_IDENTIFIER="$(prompt_value "Apple team identifier")"
APPLE_WALLET_SIGNER_CERT="$(prompt_secret_multiline "Apple signer certificate PEM")"
APPLE_WALLET_SIGNER_KEY="$(prompt_secret_multiline "Apple signer private key PEM")"
APPLE_WALLET_WWDR_CERT="$(prompt_secret_multiline "Apple WWDR certificate PEM")"

GOOGLE_WALLET_ISSUER_ID="$(prompt_value "Google Wallet issuer ID")"
GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL="$(prompt_value "Google service account email")"
GOOGLE_WALLET_PRIVATE_KEY="$(prompt_secret_multiline "Google service account private key PEM")"
GOOGLE_WALLET_ORIGINS="$(prompt_value "Google Wallet allowed origins [${GOOGLE_WALLET_ORIGINS_DEFAULT}]")"
GOOGLE_WALLET_ORIGINS="${GOOGLE_WALLET_ORIGINS:-$GOOGLE_WALLET_ORIGINS_DEFAULT}"

require_value "APPLE_WALLET_PASS_TYPE_IDENTIFIER" "$APPLE_WALLET_PASS_TYPE_IDENTIFIER"
require_value "APPLE_WALLET_TEAM_IDENTIFIER" "$APPLE_WALLET_TEAM_IDENTIFIER"
require_value "APPLE_WALLET_SIGNER_CERT" "$APPLE_WALLET_SIGNER_CERT"
require_value "APPLE_WALLET_SIGNER_KEY" "$APPLE_WALLET_SIGNER_KEY"
require_value "APPLE_WALLET_WWDR_CERT" "$APPLE_WALLET_WWDR_CERT"
require_value "GOOGLE_WALLET_ISSUER_ID" "$GOOGLE_WALLET_ISSUER_ID"
require_value "GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL" "$GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL"
require_value "GOOGLE_WALLET_PRIVATE_KEY" "$GOOGLE_WALLET_PRIVATE_KEY"

printf "\nValues captured. Length check only:\n"
printf "  Apple pass type identifier: %d chars\n" "${#APPLE_WALLET_PASS_TYPE_IDENTIFIER}"
printf "  Apple team identifier: %d chars\n" "${#APPLE_WALLET_TEAM_IDENTIFIER}"
printf "  Apple signer certificate: %d chars\n" "${#APPLE_WALLET_SIGNER_CERT}"
printf "  Apple signer key: %d chars\n" "${#APPLE_WALLET_SIGNER_KEY}"
printf "  Apple WWDR certificate: %d chars\n" "${#APPLE_WALLET_WWDR_CERT}"
printf "  Google issuer ID: %d chars\n" "${#GOOGLE_WALLET_ISSUER_ID}"
printf "  Google service account email: %d chars\n" "${#GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL}"
printf "  Google private key: %d chars\n" "${#GOOGLE_WALLET_PRIVATE_KEY}"
printf "  Google origins: %s\n" "$GOOGLE_WALLET_ORIGINS"
printf "\nType UPDATE to write secrets and update Cloud Run: "
IFS= read -r CONFIRM
if [[ "$CONFIRM" != "UPDATE" ]]; then
  printf "Cancelled. No changes made.\n"
  exit 0
fi

write_secret "APPLE_WALLET_PASS_TYPE_IDENTIFIER" "$APPLE_WALLET_PASS_TYPE_IDENTIFIER"
write_secret "APPLE_WALLET_TEAM_IDENTIFIER" "$APPLE_WALLET_TEAM_IDENTIFIER"
write_secret "APPLE_WALLET_SIGNER_CERT" "$APPLE_WALLET_SIGNER_CERT"
write_secret "APPLE_WALLET_SIGNER_KEY" "$APPLE_WALLET_SIGNER_KEY"
write_secret "APPLE_WALLET_WWDR_CERT" "$APPLE_WALLET_WWDR_CERT"
write_secret "GOOGLE_WALLET_ISSUER_ID" "$GOOGLE_WALLET_ISSUER_ID"
write_secret "GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL" "$GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL"
write_secret "GOOGLE_WALLET_PRIVATE_KEY" "$GOOGLE_WALLET_PRIVATE_KEY"

gcloud run services update "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --update-secrets "APPLE_WALLET_PASS_TYPE_IDENTIFIER=APPLE_WALLET_PASS_TYPE_IDENTIFIER:latest,APPLE_WALLET_TEAM_IDENTIFIER=APPLE_WALLET_TEAM_IDENTIFIER:latest,APPLE_WALLET_SIGNER_CERT=APPLE_WALLET_SIGNER_CERT:latest,APPLE_WALLET_SIGNER_KEY=APPLE_WALLET_SIGNER_KEY:latest,APPLE_WALLET_WWDR_CERT=APPLE_WALLET_WWDR_CERT:latest,GOOGLE_WALLET_ISSUER_ID=GOOGLE_WALLET_ISSUER_ID:latest,GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL=GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL:latest,GOOGLE_WALLET_PRIVATE_KEY=GOOGLE_WALLET_PRIVATE_KEY:latest" \
  --update-env-vars "GOOGLE_WALLET_ORIGINS=${GOOGLE_WALLET_ORIGINS},APPLE_WALLET_ORGANIZATION_NAME=ALMA Group,GOOGLE_WALLET_CLASS_SUFFIX=alma_gift_card"

printf "\nDone. Wallet routes will work after Cloud Run has rolled the new revision.\n"
