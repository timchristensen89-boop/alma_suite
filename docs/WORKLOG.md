# Separation Worklog

Running log of the autonomous stock-forward separation work, plus a PARKED list
of anything uncertain/risky that was isolated and skipped rather than blocking.

## Session 2026-06-19 — Phase 0 + scaffolding for Phases 1/3

### Done (verified)
- **Domain map**: all 120 Prisma models classified → `docs/DOMAIN_MAP.md`, `packages/db/domain-map.json`. (`prisma validate` ✅)
- **Schema annotation (Phase 0)**: every model tagged `// @domain:` in `schema.prisma` (comments only). 120/120 tagged, 0 unmapped. (`prisma validate` ✅)
- **Boundary guard (Phase 0)**: `scripts/check-domain-boundaries.mjs` + `pnpm check:boundaries`. Live result: **117 cross-domain accesses** — 114 `apps/api → stock`, 3 `apps/stock-api → workforce` (reverse seam). Warn mode (exit 0); `--strict` to fail CI.
- **Stock read client (Phase 1)**: `apps/api/src/clients/stock-client.ts` — the single approved read path for the suite into stock. (`apps/api` typecheck ✅)
- **Workforce API skeleton (Phase 3)**: `apps/staff-api` (port 3020), mirrors stock-api. Boots live: `/health` ✅, stub routes return 501 ✅. (`@alma/staff-api` typecheck ✅, `@alma/stock-api` typecheck still ✅)
- **People API client**: `apps/staff-api/src/clients/people-client.ts` — resolves identity from the suite (no cross-DB FK).
- **Plan docs**: `SEPARATION_PLAN.md`, `PEOPLE_VS_WORKFORCE.md`, `STAFF_WEB_BREAKUP.md` (App.tsx line-by-line bucket map).
- **Root scripts**: added `dev:staff-api`, `check:boundaries`.

### Verification run
- `prisma validate` → valid 🚀
- `pnpm --filter @alma/staff-api typecheck` → clean
- `pnpm --filter @alma/stock-api typecheck` → clean (unchanged)
- `pnpm --filter @alma/api typecheck` → clean (stock-client compiles)
- staff-api live boot → `/health` ok, `/api/roster` → 501 stub
- `node scripts/check-domain-boundaries.mjs` → runs, 117 findings reported
- Prisma client regenerated after install (restored working state)

## Session 2026-06-19 (cont.) — Phase 1 made real, on branch `refactor/stock-forward-separation`

### Done (verified)
- **stock-client aligned to real endpoints** — rewrote against the actual
  stock-api routes (verified in `apps/stock-api/src/routes/*`): `venue` slug param,
  `withSales`, `/recipes/cost-of-goods`, `includeNoItem`, `/operations/wastage`.
  Removed the invented `/items/venue`. (`apps/api` typecheck ✅)
- **Boundary guard refined** — excludes maintenance (one-off `scripts/**`, Prisma
  `migrations`/`seeds`) and ignores comments. True runtime worklist now **72**
  accesses (was 118 raw): 69 `apps/api → stock` + 3 `apps/stock-api → workforce`.
  Real targets: integration.service (47), reports.service (13), loaded-import (8),
  staff.service (1).
- **Guard wired into CI** — new `domain-boundaries` job in `.github/workflows/ci.yml`,
  WARN mode (never fails the build; flip to `--strict` when worklist hits zero).
- **Flag-gated read adapter** — `apps/api/src/clients/stock-reads.ts` with
  `USE_STOCK_API_READS` (default OFF). Centralizes the rollout toggle; imports no
  stock Prisma model. (`apps/api` typecheck ✅)
- **Migration recipe** — `docs/MIGRATION_RECIPE.md`: exact shadow-safe steps to
  reroute one read, with the runtime worklist table.

### Verification run (session 2)
- `apps/api` typecheck → clean (new client + adapter compile)
- `node scripts/check-domain-boundaries.mjs` → 72 runtime accesses, comment false-positive fixed
- `ci.yml` parses; jobs: typecheck, domain-boundaries

---

## Session 2026-06-20 — reports.service stock reads sealed (flag-gated + live-verified)

Rerouted the reports.service stock reads behind `USE_STOCK_API_READS` (default-off
= original Prisma), each proven on the embedded Postgres via
`verify-dashboard-stock-parity.ts`:
- #2 catalogue count, #10 recipe costs — existing endpoints.
- #8 wastage — new `GET /operations/wastage-report` (date-ranged, all reasons, uncapped).
- #11–13 stocktake status — ported to `stocktakesService.venueStatus` + `GET /stocktake/venue-status`.
- #1/#3/#4/#5/#6 — whole `buildStockSummary` ported to `stockReportsService.buildStockSummary` + `GET /stocktake/stock-summary`; report delegates. Full `ReportsStockSummary` deep-equals.
- #7 COGS lines — new `GET /invoices/cogs-lines`.

**12 of 13 reports stock reads rerouted + verified; #9 (Square mapping) parked as integration-domain.**
All flag-gated default-off; Prisma branches retained (guard holds at 72 by design).
stock-api + apps/api typecheck clean throughout. Commits: 583b72b, dacfea0, 4cdf455, 1c170ad, + this.

## PARKED (isolated, not blocking — revisit before merging to main)

1. **staff-api real auth** — skeleton uses a permissive dev pass-through
   (`auth-middleware.ts`, clearly TODO'd). Port `session.ts` + auth handoff from
   stock-api and enforce `STAFF` app access before any route reads data. *No data
   risk now: all routes are 501 stubs.*
2. **gcp-build not updated** — deliberately did NOT add staff-api to the prod
   `gcp-build` script, to avoid affecting the deploy pipeline while it's a stub.
   Add when it serves real routes.
3. **pnpm-lock.yaml changed** — online install added staff-api deps and bumped a
   few transitive patch versions. Legit (new workspace package) but review the
   lockfile diff before committing.
4. **Reverse seam: stock-api → workforce** — `recipes.service.ts` and
   `stock-operations.service.ts` read `salesActualEntry`/`salesItemActualEntry`.
   Must be resolved when the workforce DB splits (Phase 4). Flagged by the guard.
5. **staff-api deps trimmed** — removed `@prisma/client`, `@alma/db`, `bcryptjs`,
   `zod` from staff-api for now (skeleton has no DB access by design). Re-add when
   real workforce services land.
6. **stock-client endpoint shapes assumed** — e.g. `/api/items/venue`,
   `/api/invoices` query params. Confirm against stock-api routes when wiring real
   calls; some read endpoints may need adding to stock-api.
7. **Web live-preview** — full browser screenshots of the web apps need their DB +
   env + a browser; not runnable headless from here. Verified the APIs via live
   boot + typechecks instead. Can do a guided Chrome preview against a running
   instance on request.
8. **Pre-existing `any`s in `packages/db/src/govee.ts`** — surface only when the
   Prisma client isn't generated; not introduced by this work.
9. **Live reroute of `staff.service.ts` manager-dashboard stockItem read —
   ✅ WIRED + VERIFIED.** Default-OFF runs the original Prisma query unchanged
   (typecheck ✅). Flag-ON sources from stock-api via `stockReads.activeItems()`.
   Verified two ways, no production data needed:
   - `apps/api/scripts/verify-stock-reads.ts` — HTTP+token+normalization against a
     fake stock-api: ARCHIVED filtered, fields mapped, picks `onHand` not
     `totalOnHand`, low-stock matches. **PASS.**
   - `apps/api/scripts/verify-dashboard-stock-parity.ts` — LIVE on an embedded
     userspace Postgres (migrated + seeded with test stock): the dashboard's
     Prisma query and stock-api's `itemsService.list` return the **identical**
     normalized item set and low-stock result (3 active, low-stock 2). **PASS.**
   How the live DB was run here (sandbox has no docker/root): `embedded-postgres`
   npm pkg → `initdb`/`pg_ctl` on :5438 → `prisma migrate deploy` → seed. The
   Prisma branch is retained pending your shadow-run on real venue data, so the
   guard still lists this line (by design).
10. **Service-to-service auth — PARKED.** The flag-ON path uses an interim
    `STOCK_API_TOKEN` env for shadow testing. A proper suite→stock-api handoff
    (so it works without a manual token) is still to do.
