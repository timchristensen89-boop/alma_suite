# @alma/staff-api (Workforce API) — scaffold

Destination service for the **workforce engine** extraction: rostering, clock,
timesheets, tips, pay, leave, forecasting. Mirrors `apps/stock-api`'s structure.

> Status: **scaffold**. Boots and serves `/health`. All feature routes return
> `501` until their logic is migrated out of the monolith `apps/api`
> (`staff.service.ts`). It owns no data yet and is safe to run.

## Why this exists
The suite is being refactored to be **stock-forward**. The complex, regulated
workforce domain is being pulled into its own app behind an API. Crucially,
**person identity (`StaffProfile`) stays in the suite** — this service resolves
people via the suite's People API (`src/clients/people-client.ts`), not via a
cross-database foreign key. See `docs/DOMAIN_MAP.md` and `docs/SEPARATION_PLAN.md`.

## Run (dev)
```bash
pnpm --filter @alma/staff-api dev   # http://localhost:3020/health
```

## Layout
- `src/server.ts` — express app, mounts routers
- `src/env.ts` — config (port 3020, cookie `alma.staff.sid`)
- `src/lib/` — http helpers, auth middleware (scaffold), stub factory
- `src/routes/` — roster, timesheets, tips, leave, clock (stubs)
- `src/clients/people-client.ts` — read-only person identity from the suite

## Next steps (Phase 3, see SEPARATION_PLAN.md)
1. Port `session.ts` + auth handoff from stock-api; enforce `STAFF` app access.
2. Move workforce services/routes from `apps/api` into here, one feature at a time.
3. Replace `staffProfileId` FK reads with `people-client` lookups.
4. Point a modular `staff-web` at this API instead of the monolith.
