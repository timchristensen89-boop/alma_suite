# Alma Suite Agent Guide

## Repo Layout

- `apps/api` — Express API for Compliance, Staff, Settings, Gift Cards, Reserve, Marketing, Reports support, and shared auth.
- `apps/stock-api` — Express API for Stock.
- `apps/web` — Compliance React/Vite frontend.
- `apps/stock-web` — Stock React/Vite frontend. The real stocktake workflow lives in `apps/stock-web/src/pages/StocktakePage.tsx`.
- `apps/staff-web`, `apps/reports-web`, `apps/reserve-web`, `apps/marketing-web`, `apps/giftcards-web` — sibling frontend apps.
- `packages/db` — Prisma schema, migrations, seeds, and import scripts. Prisma schema is `packages/db/prisma/schema.prisma`.
- `packages/shared` — shared Zod schemas and TypeScript types.
- `packages/ui` — shared UI primitives.
- `scripts` — local setup and production/import helpers.
- `docs` — architecture, deployment, and import runbooks.

## Package Manager

Use pnpm only. Do not switch commands back to npm or yarn.

Common commands from the repo root:

```bash
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm typecheck
pnpm build
```

Local dev:

```bash
pnpm dev
pnpm dev:stock
pnpm dev:staff
pnpm dev:reports
```

Production migration and bootstrap:

```bash
pnpm db:migrate:production
pnpm db:seed:prod
pnpm db:import:alma-control -- --file tmp/alma-control-export.json --dry-run
```

Never run `pnpm db:migrate`, `prisma migrate dev`, or `pnpm db:seed` against production.

## Module Rules

- Alma Suite is local first and multi venue.
- Core live products are Compliance, Stock, and Staff. Academy and Control dashboard are later lanes.
- Keep existing routes and module boundaries unless the current architecture blocks the requested fix.
- Do not add fake pages, placeholder module shells, or dead buttons.
- Make visible buttons either perform the action safely or remove/disable them.
- Keep environment-specific URLs and secrets in env vars. Do not hardcode production secrets or localhost production URLs.

## Stock Safety Rule

Stocktake submission must not directly mutate `StockItem.onHand`.

The safe flow is:

1. Create stocktake.
2. Save counted lines.
3. Submit as ready for review.
4. Manager/admin approves the submitted stocktake.
5. Approval creates `InventoryMovement` ledger records.
6. `StockItem.onHand` may update only inside that ledger-backed approval transaction.

Double approval must be blocked. Applied stocktakes must not be casually edited, reopened, or deleted without a safe reversal flow.

Corrections and reversals must also be ledger-backed. Use `InventoryMovement` rows with `STOCKTAKE_CORRECTION` or `STOCKTAKE_REVERSAL`; do not hand-edit balances or delete an applied stocktake before a reversal exists.

## Seed And Import Safety

- `pnpm db:seed` is local/demo only.
- `pnpm db:seed:prod` is the tiny, non-destructive production bootstrap.
- `pnpm db:import:alma-control` is the production import path. Use `--dry-run` first.
- Uploaded Alma operational documents and historical exports are source material, not final truth. Clean and validate before import.
- Do not add demo passwords or sensitive staff records to production import scripts.

## Done Criteria

Before calling a task done, run the narrow checks for the touched package and the full workspace checks when practical:

```bash
pnpm typecheck
pnpm build
```

For Stock changes, also run:

```bash
pnpm --filter @alma/stock-api test
```

Report files changed, commands run, test results, migrations/env changes, remaining risks, and the next recommended mission.
