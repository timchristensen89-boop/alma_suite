# staff-web breakup plan — App.tsx (17,008 lines → modules)

`apps/staff-web/src/App.tsx` is one 17k-line file. It must be broken into per-feature
modules **before** the workforce engine can be cleanly extracted. Do it
incrementally with the app running — extract one page at a time, lowest risk first.

Target structure:
```
src/pages/people/      ← stays with the suite (identity)
src/pages/workforce/   ← extracts to the new staff-web/workforce app
src/pages/dashboard/   ← hybrid manager views (read from both)
src/pages/shared/      ← cross-cutting utils (auth, api client, formatters)
```

## Page inventory (line ranges, bucket)

### People-core (stays) — ~5,960 LOC
| Page | Lines | Bucket |
|---|---|---|
| StaffHome | 926–1390 | people |
| StaffProfilesPage | 1391–1660 | people |
| StaffMemberHome | 1661–2083 | people (reads roster) |
| StaffMemberCompliancePage | 2596–2669 | people |
| StaffMemberDocumentsPage | 2670–2797 | people |
| StaffMemberAcademyPage | 2798–3538 | people (training) |
| StaffProfileWorkspacePage | 3539–4632 | people |
| InvitesPage | 4633–6108 | people |
| CommunicationsPage | 6109–6787 | people (team comms) |
| AdminPage | 6788–7822 | people (role templates, settings) |
| TrainingPage | 7823–8313 | people |
| HrOverviewPage / HrSectionPage | 8314–8922 | people |
| PublicOnboardingPage | 16209–17008 | people (public) |

### Workforce (extracts) — ~6,898 LOC
| Page | Lines | Bucket |
|---|---|---|
| StaffMemberRosterPage | 2084–2329 | workforce |
| StaffMemberClockPage | 2330–2479 | workforce |
| StaffMemberLeavePage | 2480–2595 | workforce |
| LeaveCalendarPage | 8923–9260 | workforce |
| RosterPage | 9261–12579 | workforce (LARGEST — do last) |
| ApprovalsPage | 12580–12958 | workforce |
| TipsPage | 12959–13833 | workforce |
| StaffMemberTipsPage | 13834–13938 | workforce |
| StaffMemberPayPage | 13939–14105 | workforce |
| TimesheetsPage | 14961–16208 | workforce |

### Hybrid (read from both) — ~855 LOC
| Page | Lines |
|---|---|
| VenueReadinessPage | 14106–14255 |
| ManagerDailyBriefPage | 14256–14538 |
| ManagerDashboardPage | 14539–14960 |

→ Keep these with people-core but have them read a workforce "labour snapshot"
endpoint (`/labour/me`, `/manager/today`) from staff-api once it exists.

## Shared (must stay shared)
`useAuth` context, `api` client, `StaffProfile`/`RosterShift`/`Timesheet`/`Tip`/`Leave`
types, `StaffRoleTemplate`, `AppSettings`, `formatPayCents`, validators/draft helpers.
Extract these to `src/pages/shared/` (or `src/lib/`) FIRST so both buckets import
from one place.

## Incremental extraction order (lowest risk first)
1. **Public/auth pages** (PublicOnboarding, Login, password recovery) — already near-standalone.
2. **People list pages** (StaffHome, StaffProfilesPage, AdminPage) — simple state.
3. **StaffProfileWorkspacePage** — large but self-contained (pass hrRecords as props).
4. **InvitesPage** — move draft utils to shared first.
5. **Workforce leaf pages** (LeaveCalendar, Approvals, Tips, Timesheets) — self-contained.
6. **RosterPage (3,319 lines)** — last; deepest state, central orchestrator.
7. **Hybrid dashboards** — after both sides exist; wire to labour-snapshot endpoint.

Each step is done when: the page renders, CRUD works, and nav routing is intact —
verify with a live preview before moving to the next.
