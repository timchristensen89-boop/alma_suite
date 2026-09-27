#!/usr/bin/env bash
set -euo pipefail

# Why is a worked shift showing as leave — and is that Deputy's view or ours?
#
# Read only. Writes nothing to the database and nothing to Deputy.
#
# For one person and one week it prints:
#   1. every timesheet row the suite holds for them — day, times, hours,
#      status, the Leave badge and its kind, where the row came from
#      (Deputy sync / Xero import / clock-in / manual) and the row's note;
#   2. for the Deputy-sourced rows, the raw Deputy Timesheet fields as Deputy
#      sends them today (IsLeave, LeaveRule, LeaveId, TotalTime, approval), and
#      a verdict per row: leave in Deputy, worked in Deputy but badged leave
#      here, or agreeing;
#   3. the person's approved leave requests in the suite over the same window;
#   4. what else that week depends on the flag (tips manual-hours import,
#      Xero export batch), and the exact command to re-sync the week.
#
#   STAFF=Caio ./scripts/timesheet-leave-diagnose.sh
#       ...the week ending last Sunday.
#
#   STAFF=Caio WEEK_ENDING=2026-09-20 ./scripts/timesheet-leave-diagnose.sh
#       ...the Monday-to-Sunday week ending on that date.
#
# STAFF matches first or last name, case-insensitive; several matches are all
# shown. Run on the VPS from the checkout, e.g. /opt/alma/alma-suite.

DEPLOY_DIR="${DEPLOY_DIR:-/opt/alma/deploy}"

SERVICE="${SERVICE:-}"
if [ -z "$SERVICE" ]; then
  SERVICE="$( (cd "$DEPLOY_DIR" && docker compose ps --services) | grep -E '^(suite-api|stock-api|api)$' | head -1 || true )"
fi
if [ -z "$SERVICE" ]; then
  echo "Could not find an API service in $DEPLOY_DIR." >&2
  (cd "$DEPLOY_DIR" && docker compose ps --services) >&2
  exit 1
fi
if [ -z "${STAFF:-}" ]; then
  echo "Set STAFF to part of the person's name, e.g. STAFF=Caio $0" >&2
  exit 1
fi

echo "-> API service: ${SERVICE}"
echo "-> Mode:        READ ONLY - nothing is written, in the suite or in Deputy"
echo

SCRIPT_IN_CONTAINER="/workspace/apps/api/.timesheet-leave-diagnose.mjs"

(cd "$DEPLOY_DIR" && docker compose exec -T "$SERVICE" sh -c "cat > $SCRIPT_IN_CONTAINER") <<'JSEOF'
import { prisma } from '@alma/db';

const STAFF = (process.env.STAFF || '').trim();
const WEEK_ENDING = (process.env.WEEK_ENDING || '').trim();
const TZ = 'Australia/Sydney';

const pad = (v, w) => { const t = String(v ?? ''); return t.length >= w ? t : t + ' '.repeat(w - t.length); };
const padL = (v, w) => { const t = String(v ?? ''); return t.length >= w ? t : ' '.repeat(w - t.length) + t; };
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const clock = (d) => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
const dow = (key) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${key}T00:00:00Z`).getUTCDay()];
const hours = (a, b, breakMinutes) => Math.max(0, ((b - a) / 3_600_000) - (breakMinutes || 0) / 60).toFixed(2);

// ---- the week ---------------------------------------------------------------
// workDate is stored as UTC midnight of the venue day, so the window is built
// from day keys, not instants.
let sundayKey = WEEK_ENDING;
if (!sundayKey) {
  const today = new Date(`${dayKey(new Date())}T00:00:00Z`);
  const back = (today.getUTCDay() + 7 - 0) % 7; // days since Sunday
  today.setUTCDate(today.getUTCDate() - (back === 0 ? 7 : back));
  sundayKey = today.toISOString().slice(0, 10);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(sundayKey)) {
  console.error(`WEEK_ENDING must be YYYY-MM-DD, got "${sundayKey}"`);
  process.exit(1);
}
const weekEnd = new Date(`${sundayKey}T00:00:00Z`);
const weekStart = new Date(weekEnd); weekStart.setUTCDate(weekStart.getUTCDate() - 6);
const weekEndExclusive = new Date(weekEnd); weekEndExclusive.setUTCDate(weekEndExclusive.getUTCDate() + 1);
const startKey = weekStart.toISOString().slice(0, 10);

console.log(`WEEK  ${dow(startKey)} ${startKey}  to  ${dow(sundayKey)} ${sundayKey}   (venue days, ${TZ})`);
console.log(`STAFF "${STAFF}"\n`);

// ---- who ------------------------------------------------------------------------
const people = await prisma.staffProfile.findMany({
  where: {
    OR: [
      { firstName: { contains: STAFF, mode: 'insensitive' } },
      { lastName: { contains: STAFF, mode: 'insensitive' } }
    ]
  },
  select: { id: true, firstName: true, lastName: true, venue: true, roleTitle: true, employmentStatus: true, mergedIntoStaffProfileId: true },
  orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
});
if (!people.length) {
  console.log('No staff profile matches that name. Check the spelling in Staff -> People.');
  await prisma.$disconnect();
  process.exit(0);
}
console.log(`MATCHING PROFILES (${people.length})`);
for (const p of people) {
  console.log(`  ${p.firstName} ${p.lastName}  ${p.venue ?? '(no venue)'}  ${p.roleTitle ?? ''}  ${p.employmentStatus ?? ''}${p.mergedIntoStaffProfileId ? '  [merged into another profile]' : ''}`);
}
console.log();

// ---- the rows -------------------------------------------------------------------
const rows = await prisma.timesheet.findMany({
  where: { staffProfileId: { in: people.map((p) => p.id) }, workDate: { gte: weekStart, lt: weekEndExclusive } },
  orderBy: [{ workDate: 'asc' }, { clockInAt: 'asc' }],
  include: { staffProfile: { select: { firstName: true, lastName: true } } }
});

const origin = (r) => r.deputyTimesheetId ? `Deputy ${r.deputyTimesheetId.replace(/^deputy-/, '#')}`
  : r.xeroImportKey ? 'Xero import'
  : r.clockSessionId ? 'Clock-in'
  : 'Manual';

console.log(`TIMESHEET ROWS IN THE SUITE (${rows.length})`);
if (!rows.length) console.log('  none in this window');
for (const r of rows) {
  const key = r.workDate.toISOString().slice(0, 10);
  console.log(
    `  ${dow(key)} ${key}  ${clock(r.clockInAt)}-${clock(r.clockOutAt)}  ${padL(hours(r.clockInAt, r.clockOutAt, r.breakMinutes), 5)}h` +
      `  brk ${padL(r.breakMinutes, 3)}m  ${pad(r.venue ?? '-', 12)} ${pad(r.status, 9)} ${pad(origin(r), 16)}` +
      `  ${r.isLeave ? `LEAVE (${r.leaveKind ?? 'kind unknown'})` : 'worked'}` +
      `${r.xeroExportBatchId ? '  [pushed to Xero]' : ''}`
  );
  if (r.notes) console.log(`        note: ${r.notes}`);
}
const leaveRows = rows.filter((r) => r.isLeave);
console.log(`\n  ${leaveRows.length} of ${rows.length} row(s) carry the Leave flag.`);
console.log('  The flag is only ever set by the Deputy timesheet sync (deputyIsLeave); clock-in,');
console.log('  Xero-import and manual rows are always "worked". A generic kind of just "Leave"');
console.log('  means the Deputy leave rule id did not resolve to a named rule.\n');

// ---- what Deputy says today -----------------------------------------------------
const deputyIds = rows
  .map((r) => Number((r.deputyTimesheetId ?? '').replace(/^deputy-/, '')))
  .filter((n) => Number.isInteger(n) && n > 0);

console.log(`DEPUTY'S OWN VIEW OF THE ${deputyIds.length} DEPUTY-SOURCED ROW(S)`);
if (!deputyIds.length) {
  console.log('  No Deputy-sourced rows in this window, so Deputy has nothing to say here.\n');
} else {
  let deputy = null;
  try {
    // The compiled service the API itself runs (see Dockerfile): same token
    // handling, same endpoint. The helper is read only.
    deputy = await import('./dist/apps/api/src/services/deputy.service.js');
  } catch (error) {
    console.log(`  Could not load the built Deputy service (${error?.message ?? error}).`);
    console.log('  The suite rows above are still the facts; re-run after the next deploy for the Deputy side.\n');
  }
  if (deputy) {
    try {
      const connection = await deputy.deputyService._internal.connectedDeputyConnection();
      const raw = await deputy.deputyService._internal.inspectTimesheets(connection, deputyIds);
      const byId = new Map(raw.map((t) => [t.Id, t]));
      const bit = (v) => v === true || v === 1 || (typeof v === 'string' && ['1', 'true'].includes(v.trim().toLowerCase()));
      const posId = (v) => { const n = typeof v === 'string' ? Number(v.trim()) : v; return Number.isInteger(n) && n > 0 ? n : null; };
      const show = (v) => (v === undefined ? 'absent' : JSON.stringify(v));
      let disagree = 0;
      for (const r of rows) {
        const id = Number((r.deputyTimesheetId ?? '').replace(/^deputy-/, ''));
        if (!Number.isInteger(id) || id <= 0) continue;
        const t = byId.get(id);
        const key = r.workDate.toISOString().slice(0, 10);
        if (!t) {
          console.log(`  #${id}  ${dow(key)} ${key}  -- not returned by Deputy (deleted there, or outside what the token may read)`);
          continue;
        }
        const deputyLeave = bit(t.IsLeave) || posId(t.LeaveRule) !== null;
        const legacyRead = Boolean(t.IsLeave) || t.LeaveRule != null; // how the import read it before the fix
        let verdict;
        if (deputyLeave && r.isLeave) verdict = 'AGREE: leave in Deputy too - fix it in Deputy (edit or remove the leave), then re-sync';
        else if (!deputyLeave && r.isLeave) verdict = legacyRead
          ? 'DISAGREE: worked in Deputy; the import read a 0/blank rule id as leave - fixed in code, re-sync clears it'
          : 'DISAGREE: worked in Deputy now (was it leave when last synced?) - re-sync clears it';
        else if (deputyLeave && !r.isLeave) verdict = 'DISAGREE: Deputy now says leave but the suite says worked - re-sync will flag it';
        else verdict = 'agree: worked';
        if (verdict.startsWith('DISAGREE')) disagree += 1;
        console.log(
          `  #${id}  ${dow(key)} ${key}  IsLeave=${show(t.IsLeave)}  LeaveRule=${show(t.LeaveRule)}  LeaveId=${show(t.LeaveId)}` +
            `  TotalTime=${show(t.TotalTime)}  TimeApproved=${show(t.TimeApproved)}${t.Discarded ? '  DISCARDED' : ''}`
        );
        console.log(`        ${verdict}`);
      }
      console.log(`\n  ${disagree} row(s) where Deputy and the suite disagree.\n`);
    } catch (error) {
      console.log(`  Could not read Deputy: ${error?.message ?? error}`);
      console.log('  (paused or disconnected connection, or Deputy is down). The suite rows above still stand.\n');
    }
  }
}

// ---- leave requests in the suite --------------------------------------------------
const leaveRequests = await prisma.staffLeaveRequest.findMany({
  where: { staffProfileId: { in: people.map((p) => p.id) }, startDate: { lt: weekEndExclusive }, endDate: { gte: weekStart } },
  select: { type: true, status: true, startDate: true, endDate: true, staffProfile: { select: { firstName: true, lastName: true } } }
});
console.log(`LEAVE REQUESTS IN THE SUITE OVER THIS WEEK (${leaveRequests.length})`);
if (!leaveRequests.length) console.log('  none - so nothing in the suite itself says this person was on leave');
for (const l of leaveRequests) {
  console.log(`  ${l.staffProfile.firstName} ${l.staffProfile.lastName}  ${l.type}  ${l.status}  ${l.startDate.toISOString().slice(0, 10)} to ${l.endDate.toISOString().slice(0, 10)}`);
}
console.log();

// ---- what else depends on the flag ----------------------------------------------
const manualHours = await prisma.staffTipManualHoursEntry.findMany({
  where: { staffProfileId: { in: people.map((p) => p.id) }, weekStart: { gte: weekStart, lt: weekEndExclusive } },
  select: { venue: true, hours: true, notes: true, weekStart: true }
});
console.log('WHAT ELSE THIS WEEK DEPENDS ON THE FLAG');
if (manualHours.length) {
  for (const m of manualHours) {
    console.log(`  Tips manual-hours entry: ${m.venue}  ${m.hours}h  (week of ${m.weekStart.toISOString().slice(0, 10)})${m.notes ? `  ${m.notes}` : ''}`);
  }
  console.log('  -> that entry overrides the person\'s timesheets for the tips split. After the rows are');
  console.log('     corrected, re-run "Import Deputy hours" for this week on the Tips page so the hours include them.');
} else {
  console.log('  No tips manual-hours entry: the tips split reads the timesheets directly, so it follows the flag.');
}
const pushed = rows.filter((r) => r.xeroExportBatchId).length;
console.log(`  ${pushed} of ${rows.length} row(s) already pushed to Xero. Rows flagged leave were left out of that push;`);
console.log('  once corrected they are APPROVED and the next Xero timesheet push for this week picks them up.\n');

// ---- the sync window --------------------------------------------------------------
const todayKey = dayKey(new Date());
const lookbackStart = new Date(`${todayKey}T00:00:00Z`); lookbackStart.setUTCDate(lookbackStart.getUTCDate() - 14);
const inWindow = rows.filter((r) => r.workDate >= lookbackStart).length;
const daysBack = Math.ceil((new Date(`${todayKey}T00:00:00Z`) - weekStart) / 86_400_000) + 1;
console.log('RE-SYNCING THE WEEK');
console.log(`  The nightly Deputy sync re-reads the last 14 days (from ${lookbackStart.toISOString().slice(0, 10)}); ${inWindow} of ${rows.length} row(s) are still inside that.`);
console.log(`  To re-read the whole week now, run on the VPS (uses the scheduler secret from the API env file):`);
console.log(`    curl -fsS -m 300 -X POST -H "Content-Type: application/json" \\`);
console.log(`      -H "Authorization: Bearer $(grep -m1 ^INTEGRATION_SCHEDULER_SECRET= /opt/alma/deploy/env/suite-api.env | cut -d= -f2-)" \\`);
console.log(`      -d '{"timesheetLookbackDays":${Math.max(14, daysBack)}}' https://api.almagroup.com.au/api/integration-jobs/deputy/sync`);
console.log('  A row Deputy itself marks as leave stays leave after a re-sync - correct it in Deputy first.');
console.log('\nRead only - nothing was written.');
await prisma.$disconnect();
JSEOF

(cd "$DEPLOY_DIR" && docker compose exec -T -w /workspace/apps/api \
  -e "STAFF=${STAFF}" \
  -e "WEEK_ENDING=${WEEK_ENDING:-}" \
  "$SERVICE" node "$SCRIPT_IN_CONTAINER")
