# Stock-Forward Refactor — Migration Plan

**Goal:** finish Alma as a stock-forward back-of-house suite (Stock + Compliance + People-core), and extract the Workforce engine (rostering, time, pay, tips, leave, forecasting) into its own app that talks to the suite over an API.

**Guiding rule:** the hard part is the *data boundary*, not the *app split*. Separate apps that share one Postgres are not separated. Every phase below is about drawing and enforcing the data line.

**Companion docs:** `docs/DOMAIN_MAP.md` (human), `packages/db/domain-map.json` (machine-readable ownership).

---

## Principles (read before starting)

1. **One beast at a time.** Stock first (it's nearly there), workforce second. Never both at once while the suite is live.
2. **Lift, don't rewrite.** Move working logic; only refactor what's actually breaking. The old code holds years of edge cases.
3. **People-core stays.** `StaffProfile` and identity/certs remain in the suite. Only the workforce *engine* leaves.
4. **Boundaries before extraction.** Make domains stop reaching into each other's tables *before* moving any data.
5. **Ship behind a flag, roll to one venue, run in shadow.** Nothing critical (payroll, stock counts) flips to new code on day one.

---

## Phase 0 — Make the boundary visible (no behaviour change) ✅ STARTED

- [x] Map all 120 models to domains + identify seams (`docs/DOMAIN_MAP.md`, `domain-map.json`).
- [x] Annotate `schema.prisma` with domain section headers + per-model `// @domain:` tags.
- [x] Add a lint/check script that fails CI if a service queries a table outside its allowed domains (boundary guard). Start in **warn** mode. → `scripts/check-domain-boundaries.mjs` (`pnpm check:boundaries`), reports 117 cross-domain accesses.

_Outcome: everyone can see the lines; no runtime change._

## Phase 1 — Finish & seal Stock as the anchor

Stock already has `stock-api` + `stock-web`. The job is to make it *own* its data.

- [ ] Confirm the stock model set (21 models) and freeze its public API surface (`stock-api` routes) as the only way other apps read stock data.
- [ ] Find every place the main `api` queries stock tables directly (`reports.service`, `staff.service`, `integration.service`, `loaded-import.service`) and route those reads through `stock-api` instead of `prisma.stockItem/...`.
- [x] Add a read-only "stock client" the rest of the suite uses (thin HTTP wrapper) so no other service imports stock Prisma models. → `apps/api/src/clients/stock-client.ts` (scaffold; endpoint shapes to confirm — see WORKLOG PARKED #6).
- [ ] Deploy to **one** venue; run the rerouted reads in parallel with the old direct queries and diff results for a week.

_Exit criteria: nothing outside `stock-api` touches stock tables; one venue stable on API-based stock reads._

## Phase 2 — Split "staff" into People-core vs Workforce (still one DB)

This is the conceptual cut, done in-place before any data moves.

- [ ] In code, separate the people-core services (identity, roles, access, invites, certs/training) from the workforce services (roster, clock, timesheet, tips, pay, leave, HR, forecast) inside `apps/api`. Today they're entangled in `staff.service.ts` (6,316 lines).
- [ ] Break up `apps/staff-web/src/App.tsx` (17,008 lines) — this is the prerequisite for everything else. Split into per-feature route modules mirroring how `stock-web` is structured (pages/features). Do this incrementally, one feature out at a time, with the app still running.
- [ ] Define the **People API** the workforce engine will consume: `GET person`, `list people by venue`, `person roles/active status`. This is what replaces the `staffProfileId` foreign keys later.
- [ ] Convert workforce → stock/compliance hard FKs into soft references now (`SalesItemActualEntry.recipeId`, `ShiftTaskAssignment.rosterShiftId`) so the later DB cut is mechanical.

_Exit criteria: people-core and workforce are separate code paths sharing the DB; staff-web is modular; People API exists and is used internally._

## Phase 3 — Stand up the Workforce app

- [x] Scaffold `apps/staff-api` (workforce-api) — it has no API of its own today; mirror `stock-api`'s structure. → done; boots on :3020, `/health` ok, stub routes 501, typechecks clean.
- [ ] Move workforce routes/services out of the monolith `api` into `staff-api`, calling the People API for identity.
- [ ] Point a modular `staff-web` at `staff-api` instead of the monolith.
- [ ] Still sharing one DB at this point — prove the app boundary works before moving data.

_Exit criteria: workforce runs as its own app + API against the shared DB; suite no longer serves workforce routes._

## Phase 4 — Cut the data

- [ ] Give the workforce engine its own database (or schema). Migrate the 20 workforce models.
- [ ] Replace remaining cross-DB joins with: (a) `staffProfileId` as a value + People API hydration, or (b) a read-only person mirror kept in sync by events (preferred long-term for a local-first app — see DOMAIN_MAP §"The one hard problem").
- [ ] Backfill + dual-write during the transition; reconcile nightly.

_Exit criteria: workforce owns its data; suite DB no longer contains workforce tables._

## Phase 5 — Harden & roll out

- [ ] Roll the separated workforce app venue-by-venue, shadow mode first (read-only / parallel) for payroll-critical paths.
- [ ] Fast rollback at each venue. Keep the old path runnable until a venue is signed off.
- [ ] Remove dead monolith code only after all venues are migrated.

---

## Risk register

| Risk | Mitigation |
|---|---|
| Workforce loses `StaffProfile` join when DB splits | People API + (later) read-only person mirror; convert FK→value in Phase 2 |
| Payroll/tips/stock errors hit real money & people | One-venue rollout, shadow mode, parallel-run diffing, fast rollback |
| Rewriting instead of lifting | Explicit "lift not rewrite" rule; only refactor breaking parts |
| `App.tsx` (17k lines) blocks staff extraction | Phase 2 makes breaking it up an explicit prerequisite, done incrementally |
| Hidden cross-domain reads reappear | Boundary-guard CI check (Phase 0), escalate warn→error over time |
| Two extractions at once | Sequence enforced: stock fully sealed before workforce starts |

## Sequence at a glance
`Phase 0 (boundaries visible)` → `Phase 1 (seal stock)` → `Phase 2 (split staff in code)` → `Phase 3 (workforce app)` → `Phase 4 (cut data)` → `Phase 5 (rollout)`
