#!/usr/bin/env bash
set -euo pipefail

# Send an approved leave request to Xero Payroll as a leave application —
# or, by default, just say what it would send.
#
# Leave has never reached Xero by any route: the timesheet push drops it on
# purpose (Xero pays leave through a leave application, so sending the same
# days as ordinary hours pays them twice) and nothing picked it up on the
# other side. This is that other side.
#
# FIRST, AND IN THIS ORDER. `prisma migrate deploy` runs INSIDE the container,
# so it reads the migrations baked into the image — running it before the
# rebuild reads the OLD image and reports "no pending migrations" while doing
# nothing. Rebuild, then migrate:
#
#   cd /opt/alma/alma-suite && git fetch origin main && git checkout -f -B main FETCH_HEAD
#   cd /opt/alma/deploy && docker compose build suite-api && docker compose up -d suite-api
#   docker compose exec -T suite-api sh -c "cd /workspace/packages/db && npx prisma migrate deploy --schema prisma/schema.prisma"
#
# The migrate step should report one more migration than the run before it. If
# it says "No pending migrations to apply" and the script below then dies on
# `The table public.StaffXeroLeave does not exist`, the migrate ran against the
# old image — rebuild and migrate again.
#
# Run it on the VPS:
#
#   cd /opt/alma/alma-suite && ./scripts/xero-leave-dry-run.sh
#       ...lists approved leave you can try, newest first.
#
#   cd /opt/alma/alma-suite && LEAVE_ID=<id> ./scripts/xero-leave-dry-run.sh
#       ...says exactly what would go to which company, and sends nothing.
#
#   cd /opt/alma/alma-suite && LEAVE_ID=<id> XERO_LEAVE_CONFIRM=YES ./scripts/xero-leave-dry-run.sh
#       ...actually creates it.
#
# DO THE DRY RUN FIRST AND READ IT. A duplicate leave application in a live
# payroll draws the balance twice, pays it twice, and cannot be undone. The
# code refuses to send one it has already sent, but the first one is on you.

DEPLOY_DIR="${DEPLOY_DIR:-/opt/alma/deploy}"
LEAVE_ID="${LEAVE_ID:-}"
CONFIRM="${XERO_LEAVE_CONFIRM:-NO}"

SERVICE="${SERVICE:-}"
if [ -z "$SERVICE" ]; then
  SERVICE="$( (cd "$DEPLOY_DIR" && docker compose ps --services) | grep -E '^(suite-api|api)$' | head -1 || true )"
fi
if [ -z "$SERVICE" ]; then
  echo "Could not find the API service in $DEPLOY_DIR." >&2
  (cd "$DEPLOY_DIR" && docker compose ps --services) >&2
  echo "Re-run with SERVICE=<name>." >&2
  exit 1
fi

echo "→ API service: $SERVICE"
if [ -z "$LEAVE_ID" ]; then
  echo "→ Mode:        LIST (no LEAVE_ID given)"
elif [ "$CONFIRM" = "YES" ]; then
  echo "→ Mode:        APPLY — this writes to the live payroll"
else
  echo "→ Mode:        DRY RUN — nothing will be sent"
fi
echo

SCRIPT_IN_CONTAINER="/workspace/apps/api/.xero-leave-run.mjs"

(cd "$DEPLOY_DIR" && docker compose exec -T "$SERVICE" sh -c "cat > $SCRIPT_IN_CONTAINER") <<'JSEOF'
import { prisma } from '@alma/db';

const LEAVE_ID = process.env.LEAVE_ID ?? '';
const APPLY = process.env.APPLY === 'YES';

if (!LEAVE_ID) {
  const rows = await prisma.staffLeaveRequest.findMany({
    where: { status: 'APPROVED' },
    orderBy: { startDate: 'desc' },
    take: 25,
    select: {
      id: true, type: true, startDate: true, endDate: true,
      staffProfile: { select: { firstName: true, lastName: true, venue: true, contractedWeeklyHours: true } },
      xeroLeave: { select: { tenantName: true } }
    }
  });
  const day = (d) => d.toISOString().slice(0, 10);
  const pad = (v, w) => String(v ?? '').padEnd(w);
  console.log(pad('LEAVE ID', 27) + pad('WHO', 22) + pad('TYPE', 10) + pad('FROM', 12) + pad('TO', 12) + pad('WK HRS', 8) + 'ALREADY SENT');
  console.log('-'.repeat(105));
  for (const row of rows) {
    const who = `${row.staffProfile.firstName} ${row.staffProfile.lastName}`.trim();
    const sent = row.xeroLeave.map((x) => x.tenantName ?? 'a company').join(', ');
    console.log(
      pad(row.id, 27) + pad(who, 22) + pad(row.type, 10) + pad(day(row.startDate), 12) +
      pad(day(row.endDate), 12) + pad(row.staffProfile.contractedWeeklyHours ?? '—', 8) + (sent || '')
    );
  }
  console.log();
  console.log(`${rows.length} approved leave request(s). Pick one:  LEAVE_ID=<id> ./scripts/xero-leave-dry-run.sh`);
  console.log('A dash under WK HRS means no contracted week — leave measured in hours will be refused for them.');
  await prisma.$disconnect();
  process.exit(0);
}

const { pushLeaveToXero } = await import('/workspace/apps/api/dist/apps/api/src/services/integration.service.js');
const result = await pushLeaveToXero(LEAVE_ID, { apply: APPLY });

console.log(`Staff:   ${result.staff}`);
console.log(`Mode:    ${result.dryRun ? 'DRY RUN — nothing sent' : 'APPLIED'}`);
console.log();
if (result.organisations.length === 0) {
  console.log('Nothing to send. See the warnings below.');
} else {
  for (const org of result.organisations) {
    const where = org.tenantName ?? org.tenantId;
    if (org.action === 'already sent') {
      console.log(`  ${where}: already sent (${org.units} units, application ${org.xeroLeaveApplicationId}) — left alone.`);
    } else {
      console.log(`  ${where}: ${org.action} — ${org.leaveTypeName}, ${org.days} day(s) = ${org.units} ${org.unitsAre.toLowerCase()}${org.xeroLeaveApplicationId ? ` (application ${org.xeroLeaveApplicationId})` : ''}`);
    }
  }
}
if (result.warnings.length > 0) {
  console.log();
  console.log('Warnings:');
  for (const warning of result.warnings) console.log(`  - ${warning}`);
}
if (result.dryRun && result.organisations.some((o) => o.action === 'would create')) {
  console.log();
  console.log('Looks right? Re-run with XERO_LEAVE_CONFIRM=YES to send it.');
}
await prisma.$disconnect();
JSEOF

set +e
(cd "$DEPLOY_DIR" && docker compose exec -T \
  -e LEAVE_ID="$LEAVE_ID" \
  -e APPLY="$([ "$CONFIRM" = "YES" ] && echo YES || echo NO)" \
  "$SERVICE" sh -c "cd /workspace/apps/api && node $SCRIPT_IN_CONTAINER")
STATUS=$?
set -e

(cd "$DEPLOY_DIR" && docker compose exec -T "$SERVICE" rm -f "$SCRIPT_IN_CONTAINER") || true
exit "$STATUS"
