# Alma Production Deployment

This repo is a pnpm monorepo. Production is split into API services, static frontend apps, and one managed Postgres database. Do not run the normal demo/local seed against production.

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
- `CORS_ORIGIN` for `@alma/api`
- `RESEND_API_KEY` and `RESEND_FROM` for onboarding invite emails
- `STRIPE_SECRET_KEY` for gift card checkout payments
- `STRIPE_WEBHOOK_SECRET` for the gift card checkout webhook
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

Keep `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in the API host's secret manager. Without these values, the checkout endpoint returns a clear setup error and does not create fake successful payments.

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

After migrations are applied, create the initial admin only:

```bash
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
