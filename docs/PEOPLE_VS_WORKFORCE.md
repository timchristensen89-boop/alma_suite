# People-core vs Workforce — code seam (apps/api)

Defines where to cut `apps/api` when splitting "staff" into the People-core that
**stays** in the suite and the Workforce engine that **extracts** to `staff-api`.
Backend counterpart to `docs/STAFF_WEB_BREAKUP.md` (frontend).

The biggest knot is `apps/api/src/services/staff.service.ts` (~6,316 lines),
which today mixes both. Split it into `staff.service.ts` (people) and a new
`workforce.service.ts` (or move into `apps/staff-api`).

## PEOPLE-CORE — stays in the suite
Service methods (in staff.service.ts) and routes that deal with identity:

- Profiles: `list`, `getById`, `create`, `update` (identity fields only — **not** pay rate)
- Roles & access: `listRoleTemplates`, role CRUD, app-access changes
- Onboarding: `listInvites`, `createInvite`, `completeInvite`
- Certifications/HR docs that gate eligibility: `listHrRecords`, `createHrRecord`, `updateHrRecord` (right-to-work, contracts), compliance/training records
- Management audit log: `listManagementEvents`
- Device/kiosk auth: `listDeviceAccounts`

Routes: most of `apps/api/src/routes/staff.ts` profile/role/invite/HR endpoints.

## WORKFORCE — extracts to staff-api
Service methods that deal with scheduling/time/pay:

- Roster: `listRoster`, `createRoster`, `updateRoster`, `publishRoster`, forecast snapshots
- Clock: `clockIn`, `clockOut`, `startBreak`, `endBreak`, `listClockSessionsForReview`
- Timesheets: `listTimesheets`, `approveTimesheet`, `exportXero`
- Tips: `listTips`, cash/card/Square import, `markTipsPaid`, `generatePayout` (ABA/CSV)
- Leave: `listLeaveRequests`, `createLeaveRequest`, `updateLeaveRequest`
- Pay profiles / award rules; labour-vs-sales actuals (`SalesActualEntry`, `SalesItemActualEntry`)

Also `apps/api/src/services/deputy.service.ts` (1,160 lines) and
`shift-task.service.ts` (758 lines) are workforce-side (Deputy roster sync; shift
task assignment — note shift-tasks are the **bridge**, see DOMAIN_MAP).

## The People API (what stays behind for workforce to call)
Minimal read surface the extracted workforce engine consumes instead of a FK to
`StaffProfile`:

- `GET /api/staff` → `[{ id, displayName, role, active, venueId }]`
- `GET /api/staff/:id` → one person (permission-gated fields stripped)

This is exactly what `apps/staff-api/src/clients/people-client.ts` already calls.

## Shared (must stay shared, both sides depend on it)
- Auth/session, `AuthUser`, app-access checks (`@alma/shared`)
- `AppSettings` (award rates, org defaults)
- `StaffProfile` **type** (people-core defines; workforce reads a subset)
- Pay-change HR records: owned by people-core, but **affect** workforce payroll —
  handle via an event/notification, not a shared write.

## Cut order (lowest risk first)
1. Internally separate the two sets of methods in `staff.service.ts` (no behaviour change).
2. Stand up the People API endpoints (they mostly exist as `GET /staff`).
3. Move workforce methods/routes into `apps/staff-api`, calling the People API.
4. Convert workforce→people FKs to `staffProfileId` values + people-client hydration.
