# Square Setup

Alma uses two separate Square app credential sets:

- Primary: St Alma
- Secondary: Alma Avalon

Each Square app needs its own application ID, application secret, and webhook signature key. Do not reuse one Square app across both ABNs.

## Square Developer Dashboard Values

Find these in each Square app:

- Application ID: app overview or credentials page.
- Application secret: app credentials page.
- Webhook signature key: Webhooks > notification endpoint > signature key.

## URLs To Configure In Square

OAuth redirect URL for both Square apps:

```text
https://alma-compliance-api-433873385316.australia-southeast1.run.app/api/integrations/square/callback
```

Primary webhook URL:

```text
https://alma-compliance-api-433873385316.australia-southeast1.run.app/api/integrations/square/webhook/primary
```

Secondary webhook URL:

```text
https://alma-compliance-api-433873385316.australia-southeast1.run.app/api/integrations/square/webhook/secondary
```

## Configure Cloud Run Secrets

Run the helper from the repo root:

```bash
zsh scripts/setup-square-secrets.zsh
```

The helper prompts for each credential, writes them to Secret Manager, grants the Cloud Run runtime service account access, and updates `alma-compliance-api` environment/secrets. It prints only length checks for entered secret values.

Required runtime env/secrets:

```text
SQUARE_PRIMARY_APPLICATION_ID
SQUARE_PRIMARY_APPLICATION_SECRET
SQUARE_PRIMARY_WEBHOOK_SIGNATURE_KEY
SQUARE_PRIMARY_LABEL
SQUARE_SECONDARY_APPLICATION_ID
SQUARE_SECONDARY_APPLICATION_SECRET
SQUARE_SECONDARY_WEBHOOK_SIGNATURE_KEY
SQUARE_SECONDARY_LABEL
SQUARE_REDIRECT_URI
SQUARE_ENVIRONMENT
SQUARE_API_VERSION
SQUARE_WEBHOOK_URL
```

After setup, open Admin > Integrations. Each Square card should say either `Ready to connect` or list the missing field names.
