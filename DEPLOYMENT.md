# Alma Production Deployment

This repo is a pnpm monorepo. Production is split into API services, static frontend apps, and one managed Postgres database. Do not run the normal demo/local seed against production.

## Local Dev Baseline

From the repo root:

```bash
cp .env.example .env
pnpm install
pnpm db:up
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm typecheck
pnpm build
```

Run app pairs as needed:

```bash
pnpm dev
pnpm dev:stock
pnpm dev:staff
```

Local health checks:

```bash
curl http://localhost:3018/health
curl http://localhost:3019/health
```

Both should return `{ "ok": true }`.

## Deployable Apps

| Package | Path | Type | Production build | Production start |
| --- | --- | --- | --- | --- |
| `@alma/api` | `apps/api` | Express API for Compliance, Staff, Settings, shared auth | `pnpm --filter @alma/api build` | `pnpm --filter @alma/api start` |
| `@alma/stock-api` | `apps/stock-api` | Express API for Stock | `pnpm --filter @alma/stock-api build` | `pnpm --filter @alma/stock-api start` |
| `@alma/web` | `apps/web` | Compliance frontend | `pnpm --filter @alma/web build` | `pnpm --filter @alma/web start` |
| `@alma/stock-web` | `apps/stock-web` | Stock frontend | `pnpm --filter @alma/stock-web build` | `pnpm --filter @alma/stock-web start` |
| `@alma/staff-web` | `apps/staff-web` | Staff frontend | `pnpm --filter @alma/staff-web build` | `pnpm --filter @alma/staff-web start` |
| `@alma/reports-web` | `apps/reports-web` | Reports frontend | `pnpm --filter @alma/reports-web build` | `pnpm --filter @alma/reports-web start` |
| `@alma/reserve-web` | `apps/reserve-web` | Reserve frontend | `pnpm --filter @alma/reserve-web build` | `pnpm --filter @alma/reserve-web start` |
| `@alma/marketing-web` | `apps/marketing-web` | Marketing frontend | `pnpm --filter @alma/marketing-web build` | `pnpm --filter @alma/marketing-web start` |
| `@alma/giftcards-web` | `apps/giftcards-web` | Gift cards frontend | `pnpm --filter @alma/giftcards-web build` | `pnpm --filter @alma/giftcards-web start` |

`@alma/db`, `@alma/shared`, and `@alma/ui` are workspace packages, not standalone deployable services.

## Production Database

Use managed Postgres only. Examples: Cloud SQL for PostgreSQL, Neon, Supabase, Railway, or Render Postgres.

Production migration command:

```bash
pnpm db:migrate:production
```

This runs:

```bash
prisma migrate deploy --schema packages/db/prisma/schema.prisma
```

Do not run `pnpm db:migrate`, `prisma migrate dev`, or `pnpm db:seed` against production.

## API Deployment

Deploy both API packages if Stock is going live:

- Main API: `@alma/api`
- Stock API: `@alma/stock-api`

Common production commands:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate:production
pnpm --filter @alma/shared build
pnpm --filter @alma/db build
pnpm --filter @alma/api build
pnpm --filter @alma/stock-api build
pnpm --filter @alma/api start
```

For a separate Stock API service, use:

```bash
pnpm --filter @alma/stock-api start
```

Both APIs bind to `process.env.PORT` and `0.0.0.0` by default. Health checks are available at:

- `GET /health`
- `GET /api/health`

Use the example files as a starting point:

- `apps/api/.env.production.example`
- `apps/stock-api/.env.production.example`

Required production API settings:

- `NODE_ENV=production`
- `DATABASE_URL`
- `JWT_SECRET` or `SESSION_SECRET` for `@alma/api`
- Production frontend origins for `@alma/api` via `CORS_ORIGIN`, `FRONTEND_URL`, or app URL vars
- `RESEND_API_KEY` and `RESEND_FROM` for onboarding invite emails
- `STRIPE_SECRET_KEY` for gift card checkout payments
- `STRIPE_WEBHOOK_SECRET` for the gift card checkout webhook
- `STRIPE_CONTEXT` when `STRIPE_SECRET_KEY` is an Organization API key and Stripe requires a target account context
- `STOCK_JWT_SECRET`, `STOCK_SESSION_SECRET`, or `JWT_SECRET` for `@alma/stock-api`
- Production stock frontend origins via `STOCK_CORS_ORIGIN` or `COMPLIANCE_WEB_URL`, `STOCK_WEB_URL`, `STAFF_WEB_URL`, `REPORTS_WEB_URL`, `RESERVE_WEB_URL`, `MARKETING_WEB_URL`, and `GIFTCARDS_WEB_URL`

Production validation refuses to boot with localhost CORS origins.

Onboarding email delivery uses Resend first when configured. SMTP remains as a fallback for older deployments. Use a verified Resend sender/domain for `RESEND_FROM`, for example:

```bash
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxx
RESEND_FROM="ALMA Staff <onboarding@yourdomain.com>"
MAIL_REPLY_TO="People Team <people@yourdomain.com>"
```

Reports can publish website menu updates through the API when a GitHub token is configured server-side. Create a fine-scoped GitHub token with write access to the website repo contents, then set:

```bash
WEBSITE_MENU_GITHUB_TOKEN=github_pat_xxxxxxxxx
WEBSITE_MENU_REPO_OWNER=timchristensen89-boop
WEBSITE_MENU_REPO_NAME=alma-web-platform
WEBSITE_MENU_BRANCH=main
WEBSITE_MENU_FILE_PATH=apps/web/data/menus.ts
WEBSITE_MENU_COMMITTER_NAME="ALMA Reports"
WEBSITE_MENU_COMMITTER_EMAIL="reports@almagroup.com.au"
```

Without `WEBSITE_MENU_GITHUB_TOKEN`, the Reports menu publisher only validates payloads and returns a clear setup error on publish.

Gift card checkout uses Stripe Checkout Sessions. Configure a Stripe webhook endpoint for:

```text
https://<giftcards-domain>/api/gift-cards/webhook
```

Subscribe it to:

```text
checkout.session.completed
```

Keep `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in the API host's secret manager. Prefer an account-level Stripe secret key. If using an Organization API key, also set `STRIPE_CONTEXT` to the target Stripe account context, for example the `acct_...` account id. Without these values, the checkout endpoint returns a clear setup error and does not create fake successful payments.

## Frontend Deployment

Deploy each frontend as a separate static app:

- Compliance: `apps/web`
- Stock: `apps/stock-web`
- Staff: `apps/staff-web`
- Reports: `apps/reports-web`
- Reserve: `apps/reserve-web`
- Marketing: `apps/marketing-web`
- Gift Cards: `apps/giftcards-web`

Use these settings on Vercel, Firebase Hosting, Netlify, Cloudflare Pages, or similar:

```bash
pnpm install --frozen-lockfile
pnpm --filter <frontend-package> build
```

Output directory:

```text
dist
```

Frontend env examples:

- `apps/web/.env.production.example`
- `apps/stock-web/.env.production.example`
- `apps/staff-web/.env.production.example`
- `apps/reports-web/.env.production.example`

Required production frontend settings:

- Compliance, Staff, and Reports: `VITE_API_URL` or `VITE_API_BASE_URL`
- Stock: `VITE_STOCK_API_URL` or `VITE_STOCK_API_BASE_URL`
- Reports also needs `VITE_STOCK_API_URL` or `VITE_STOCK_API_BASE_URL`
- All frontends: `VITE_COMPLIANCE_WEB_URL`, `VITE_STOCK_WEB_URL`, `VITE_STAFF_WEB_URL`, `VITE_REPORTS_WEB_URL`
- Reserve, Marketing, and Gift Cards links: `VITE_RESERVE_WEB_URL`, `VITE_MARKETING_WEB_URL`, `VITE_GIFTCARDS_WEB_URL`

Production frontends refuse to boot if required URLs are missing or point to localhost.

## Stocktake Approval Safety

Stocktake submission is review-only and must not update `StockItem.onHand`.

The safe live flow is:

1. Manager creates a stocktake and saves counted lines.
2. Manager marks it ready for review.
3. A manager/admin approves the submitted stocktake.
4. The Stock API creates `InventoryMovement` rows for each linked line variance.
5. `StockItem.onHand` updates only inside the same approval transaction.

Approval endpoints:

- `POST /api/stocktake/:id/approve`
- `POST /api/stocktake/:id/apply` for older clients
- `GET /api/stocktake/:id/movements` to review approval, correction and reversal history
- `POST /api/stocktake/:id/corrections` to write a ledger-backed manager correction
- `POST /api/stocktake/:id/reverse` to write reversal movements before editing or deleting an approved stocktake

Double approval returns a conflict. Applied stocktakes cannot be edited or bulk-deleted until reversal movements exist.

## Suite Sign-In Handoff

The app switcher shares sign-in between the separate Firebase apps using a short-lived suite handoff token. Set the same `SUITE_AUTH_SECRET` on both API services:

- `@alma/api`
- `@alma/stock-api`

If `SUITE_AUTH_SECRET` is missing, each API falls back to its own session secret. That is fine for a single API, but Stock handoff will not work unless both APIs use the same suite secret.

## Gift Card Wallets

Gift card wallet passes are generated only for Stripe-confirmed active cards with a remaining balance. Apple Wallet downloads a signed `.pkpass`; Google Wallet redirects to a signed Save to Google Wallet URL.

Required shared setting:

- `API_PUBLIC_URL`: public API origin used in gift card emails. For Firebase rewrites this can be `https://alma-giftcards.web.app`.

Apple Wallet settings:

- `APPLE_WALLET_PASS_TYPE_IDENTIFIER`
- `APPLE_WALLET_TEAM_IDENTIFIER`
- `APPLE_WALLET_ORGANIZATION_NAME`
- `APPLE_WALLET_SIGNER_CERT`
- `APPLE_WALLET_SIGNER_KEY`
- `APPLE_WALLET_SIGNER_KEY_PASSPHRASE` if the private key is encrypted
- `APPLE_WALLET_WWDR_CERT`

Google Wallet settings:

- `GOOGLE_WALLET_ISSUER_ID`
- `GOOGLE_WALLET_CLASS_SUFFIX`
- `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_WALLET_PRIVATE_KEY`
- `GOOGLE_WALLET_ORIGINS`

Store PEM certificates/keys as Secret Manager values or base64 strings. Do not commit wallet certificates or service account keys.

## Custom Domains

Recommended domain layout:

- `compliance.yourdomain.com` -> `apps/web`
- `stock.yourdomain.com` -> `apps/stock-web`
- `staff.yourdomain.com` -> `apps/staff-web`
- `reports.yourdomain.com` -> `apps/reports-web`
- `reserve.yourdomain.com` -> `apps/reserve-web`
- `marketing.yourdomain.com` -> `apps/marketing-web`
- `giftcards.yourdomain.com` -> `apps/giftcards-web`
- `api.yourdomain.com` -> `@alma/api`
- `stock-api.yourdomain.com` -> `@alma/stock-api`

After domains are assigned:

1. Set each frontend app URL in every frontend env file.
2. Set the same frontend origins in API CORS env vars.
3. Redeploy APIs after frontend domain changes.
4. Verify browser cookies work over HTTPS.

## Production Admin Creation

Do not use demo seed data in production.

After migrations are applied, prefer the non-destructive production bootstrap:

```bash
NODE_ENV=production \
PROD_ADMIN_EMAIL=admin@yourdomain.com \
PROD_ADMIN_PASSWORD='use-a-strong-one-time-password' \
pnpm db:seed:prod
```

If you need to repair or recreate only the master user, pass explicit credentials:

```bash
NODE_ENV=production \
MASTER_USER_EMAIL=admin@yourdomain.com \
MASTER_USER_PASSWORD='use-a-strong-one-time-password' \
MASTER_USER_FIRST_NAME='Admin' \
MASTER_USER_LAST_NAME='User' \
pnpm db:create:master-user
```

Then log in and change the password from the app.

## Production Smoke Test

1. `curl https://api.yourdomain.com/api/health` returns `{ "ok": true }`.
2. `curl https://stock-api.yourdomain.com/api/health` returns `{ "ok": true }`.
3. Open Compliance, Stock, Staff, Reports, Reserve, Marketing, and Gift Cards frontend URLs.
4. Confirm login succeeds from each frontend.
5. Confirm app switcher links go to production domains, not localhost.
6. Confirm CORS errors do not appear in the browser console.
7. Create or resend a staff onboarding invite and confirm Resend reports a delivered email.
8. Open Gift Cards, confirm the public purchase page loads, and confirm the manager redemption area requires login.
9. With Stripe configured, create a test checkout, complete payment in Stripe test mode, and confirm the card becomes active only after the webhook completes.
10. Confirm no local/demo seed users are present unless deliberately created.

## Common API Access Fixes

If a frontend shows `Cannot reach the ALMA API` or `Cannot reach the ALMA Stock API`:

1. Confirm the correct API service is running and healthy:
   - Main API: `GET https://<api-domain>/health`
   - Stock API: `GET https://<stock-api-domain>/health`
2. Confirm the frontend build env points at the correct API:
   - Compliance, Staff, and Reports: `VITE_API_URL` or `VITE_API_BASE_URL`
   - Stock: `VITE_STOCK_API_URL` or `VITE_STOCK_API_BASE_URL`
3. Do not include a double `/api` in frontend env values. The clean value is the API origin, such as `https://stock-api.example.com`.
4. Confirm API CORS includes the deployed frontend origin:
   - Main API: `CORS_ORIGIN` or app URL vars such as `STAFF_WEB_URL`
   - Stock API: `STOCK_CORS_ORIGIN`, `STOCK_FRONTEND_URL`, or app URL vars
5. Confirm production CORS and frontend env vars do not point to localhost.
6. On phones, use the deployed HTTPS frontend URL, not `localhost`. Localhost on a phone is the phone itself.
7. For cross-app sign-in, set the same `SUITE_AUTH_SECRET` on both API services and redeploy both.
8. If login works on desktop but not mobile, check HTTPS, cookie settings, and whether the app is using bearer token handoff from the suite switcher.
