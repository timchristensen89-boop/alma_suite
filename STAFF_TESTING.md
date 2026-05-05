# Alma Compliance Staff Beta Testing

This beta is for checking that real staff can sign in, see the right pages, and complete the common compliance workflows without hitting broken buttons.

## Local Start

From the repo root:

```bash
npm install
npm run dev
```

The command prepares Postgres, starts the API on `http://localhost:3018`, and starts the Compliance web app on `http://localhost:5173`.

Health checks:

```bash
curl http://localhost:3018/health
curl http://localhost:3018/api/health
```

## Test Accounts

| Role | Email | Password | Expected access |
| --- | --- | --- | --- |
| Admin | `admin@alma.local` | `almaadmin` | All pages, including Settings |
| Manager | `manager@alma.local` | `ManagerBeta2026!` | Issues, checklists, staff, temperatures, licences, incidents, audits, handbook |
| Staff | `staff@alma.local` | `StaffBeta2026!` | Overview, issues, checklists, incidents, handbook |
| Owner admin | `tim@almagroup.com.au` | `Tim@lma2017` | All pages |

## Staff Tester Tasks

1. Sign in as `staff@alma.local`.
2. Confirm the sidebar does not show Staff, Temperatures, Licences, Audits, or Settings.
3. Open Issues and create a low-severity test issue.
4. Edit that issue and change status to `IN_PROGRESS`.
5. Open Checklists and start a checklist run.
6. Mark one checklist item as failed and confirm it can create an issue.
7. Open Incidents and create a near-miss report.
8. Open Handbook and confirm guidelines/onboarding pages are readable.
9. Sign out.

## Manager Tester Tasks

1. Sign in as `manager@alma.local`.
2. Confirm Staff, Temperatures, Licences, and Audits are visible.
3. Create a staff profile with one RSA record.
4. Edit that staff profile.
5. Archive that staff profile and confirm it disappears from the active list.
6. Create or edit a licence.
7. Start an audit and add a finding.
8. Confirm Settings is not visible.
9. Sign out.

## Admin Tester Tasks

1. Sign in as `admin@alma.local`.
2. Confirm Settings is visible.
3. Update a non-sensitive setting, then save.
4. Confirm manager/staff pages still load.
5. Confirm admin profiles cannot be archived from Staff.

## Expected Error Behavior

If the API is down, the frontend should show a clear message like:

`Cannot reach the ALMA API at http://localhost:3018. Check that the API server is running and the frontend API URL is correct.`

It should not show a raw `Failed to fetch` message.
