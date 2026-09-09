#!/usr/bin/env bash
set -euo pipefail

# Restart the paused Lightspeed sync, after showing what it will land on.
#
# Pausing is not a switch to flip back without looking. From the service's own
# doc comment on setSyncPaused:
#
#   reports sum SalesActualEntry across sources for a venue+day, so a feed
#   left running alongside hand-entered sales counts the day twice.
#
# The sync writes SalesActualEntry under source 'lightspeed:{siteId}' and
# hand-entered sales carry whatever source the importer was given. They are
# separate rows on the same venue+day, and readers do not filter on source -
# so any day already carrying sales from somewhere else is a day that will be
# counted twice once this is running again.
#
# So this prints the overlap first: the window the sync will cover, and every
# day in it that already has sales from another source. Read that list before
# confirming. If the venue is still entering sales by hand, the pause is doing
# its job and the fix is to stop hand-entering first, not to unpause.
#
# Tips are not at that risk - staffTipCardEntry is keyed on importKey per
# source, and the tip calendar shows each source separately.
#
#   ./scripts/lightspeed-resume-sync.sh
#       ...why it is paused, what the sync would cover, what would double.
#
#   CONFIRM=YES ./scripts/lightspeed-resume-sync.sh
#       ...clear the pause and log the same audit event the app would.
#
#   LOOKBACK=3 ./scripts/lightspeed-resume-sync.sh
#       ...the scheduled sync's lookback in days. Default 3, matching
#          DEFAULT_SCHEDULED_LIGHTSPEED_SALES_LOOKBACK_DAYS.

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

echo "-> API service: ${SERVICE}"
if [ "${CONFIRM:-}" = "YES" ]; then
  echo "-> Mode:        WRITE - the pause will be cleared"
else
  echo "-> Mode:        DRY RUN - nothing will be written"
fi
echo

SCRIPT_IN_CONTAINER="/workspace/apps/api/.lightspeed-resume-sync.mjs"

(cd "$DEPLOY_DIR" && docker compose exec -T "$SERVICE" sh -c "cat > $SCRIPT_IN_CONTAINER") <<'JSEOF'
import { prisma } from '@alma/db';

const WRITE = process.env.CONFIRM === 'YES';
const LOOKBACK = Math.max(1, Number(process.env.LOOKBACK || '3'));

const pad = (v, w) => { const t = String(v ?? ''); return t.length >= w ? t : t + ' '.repeat(w - t.length); };
const padL = (v, w) => { const t = String(v ?? ''); return t.length >= w ? t : ' '.repeat(w - t.length) + t; };
const money = (c) => `$${(c / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (d) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') : 'never');
const key = (d) => d.toISOString().slice(0, 10);

const conn = await prisma.integrationConnection.findFirst({
  where: { provider: 'LIGHTSPEED' },
  select: {
    id: true, status: true, providerAccountName: true,
    syncPausedAt: true, syncPausedReason: true,
    lastSyncAt: true, lastSyncStatus: true, lastError: true
  }
});

if (!conn) {
  console.log('There is no Lightspeed connection at all, so there is no pause to clear.');
  console.log('Connect it in Settings -> Integrations first.');
  await prisma.$disconnect();
  process.exit(1);
}

console.log('CONNECTION');
console.log(`  status     : ${conn.status}${conn.providerAccountName ? `  (${conn.providerAccountName})` : ''}`);
console.log(`  last sync  : ${when(conn.lastSyncAt)}  ${conn.lastSyncStatus ?? ''}`);
if (conn.lastError) console.log(`  last error : ${conn.lastError}`);

if (!conn.syncPausedAt) {
  console.log('\n  This sync is NOT paused. Nothing to do here.');
  console.log('  If tips still are not arriving, the cause is elsewhere - run');
  console.log('  scripts/tips-diagnose.sh and read the sync runs and their errors.');
  await prisma.$disconnect();
  process.exit(0);
}

console.log(`  PAUSED     : since ${when(conn.syncPausedAt)}`);
console.log(`  reason     : ${conn.syncPausedReason || '(none was recorded)'}`);
if (!conn.syncPausedReason) {
  console.log('               Nobody wrote down why. That is worth knowing before');
  console.log('               restarting a feed that writes to sales.');
}
console.log();

// The window the scheduled sync replaces on its next run, pinned to Sydney
// midnight the same way integration.service.ts pins it.
const sydneyKey = (d) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(d);
const todayKey = sydneyKey(new Date());
const windowKeys = [];
for (let i = LOOKBACK - 1; i >= 0; i--) {
  const d = new Date(`${todayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - i);
  windowKeys.push(key(d));
}
const windowStart = new Date(`${windowKeys[0]}T00:00:00Z`);

console.log(`WHAT THE NEXT SYNC COVERS - ${LOOKBACK} day(s): ${windowKeys[0]} to ${windowKeys[windowKeys.length - 1]}`);
console.log('  Each of those days is REPLACED for the lightspeed source, and added');
console.log('  alongside whatever else already sits on that venue and day.\n');

// Which venues this feed actually writes for. The sync only creates rows for
// a Lightspeed site whose name resolves to a configured venue, and that
// mapping lives behind an API call - but a venue that has ever carried a
// 'lightspeed:' row is one it demonstrably covers. A venue it has never
// written for cannot be doubled by restarting it.
const everFed = await prisma.salesActualEntry.findMany({
  where: { source: { startsWith: 'lightspeed:' } },
  distinct: ['venue'],
  select: { venue: true }
});
const fedVenues = new Set(everFed.map((r) => r.venue));

const sales = await prisma.salesActualEntry.findMany({
  where: { serviceDate: { gte: windowStart } },
  orderBy: [{ venue: 'asc' }, { serviceDate: 'asc' }],
  select: { venue: true, serviceDate: true, salesCents: true, source: true }
});

// A day that already carries sales from a source the Lightspeed feed is not
// going to replace is a day that will be counted twice.
const byDay = new Map();
for (const s of sales) {
  const k = `${s.venue}|${key(s.serviceDate)}`;
  const prev = byDay.get(k) ?? { venue: s.venue, day: key(s.serviceDate), rows: [] };
  prev.rows.push(s);
  byDay.set(k, prev);
}

const clashes = [...byDay.values()].filter((d) =>
  fedVenues.has(d.venue) && d.rows.some((r) => !String(r.source ?? '').startsWith('lightspeed'))
);

console.log(`SALES ALREADY ON THOSE DAYS (${byDay.size} venue-day(s))`);
if (!byDay.size) {
  console.log('  None. Nothing for the feed to be summed on top of.');
}
for (const d of [...byDay.values()].sort((a, b) => (a.venue + a.day).localeCompare(b.venue + b.day))) {
  const other = d.rows.filter((r) => !String(r.source ?? '').startsWith('lightspeed'));
  console.log(`  ${pad(d.venue, 14)} ${d.day}`);
  for (const r of d.rows) {
    console.log(`      ${pad(r.source, 26)} ${padL(money(r.salesCents), 12)}`);
  }
  if (other.length && fedVenues.has(d.venue)) {
    const total = other.reduce((sum, r) => sum + r.salesCents, 0);
    console.log(`      !! ${money(total)} here is NOT from Lightspeed. Restarting the feed adds`);
    console.log('         its own row for this day on top, and reports sum both.');
  } else if (other.length) {
    console.log('      (this venue has never carried a Lightspeed row, so the feed does');
    console.log('       not appear to cover it - nothing here to double)');
  }
}
console.log();

if (clashes.length) {
  console.log(`WOULD DOUBLE-COUNT: ${clashes.length} venue-day(s) above.`);
  console.log('That is the exact thing the pause exists to prevent. If those sales are');
  console.log('being entered by hand, stop that first, or delete the hand-entered rows');
  console.log('for the days the feed will cover - then come back and unpause.');
  console.log('Unpausing anyway overstates revenue on those days.\n');
} else {
  console.log('No day in the window carries sales from another source, so restarting');
  console.log('the feed does not double anything.\n');
}

if (!WRITE) {
  console.log('DRY RUN - nothing was written. Re-run with CONFIRM=YES to clear the pause.');
  await prisma.$disconnect();
  process.exit(0);
}

// Mirror integrationService.setSyncPaused({ paused: false }) - clear both
// fields and log the same event, so the audit trail reads the same as it
// would had somebody done this in the app.
await prisma.integrationConnection.update({
  where: { id: conn.id },
  data: { syncPausedAt: null, syncPausedReason: null }
});
await prisma.integrationEvent.create({
  data: {
    provider: 'LIGHTSPEED',
    connectionId: conn.id,
    eventType: 'SYNC_RESUMED',
    summary: 'Lightspeed syncing resumed.',
    metadata: {
      via: 'scripts/lightspeed-resume-sync.sh',
      pausedSince: conn.syncPausedAt.toISOString(),
      pausedReason: conn.syncPausedReason ?? null,
      overlappingVenueDays: clashes.map((d) => `${d.venue} ${d.day}`)
    },
    createdByName: 'lightspeed-resume-sync.sh'
  }
});

console.log('Pause cleared. The scheduled sync will pick up on its next run.');
if (clashes.length) {
  console.log(`\nNote: ${clashes.length} venue-day(s) above had sales from another source when this`);
  console.log('ran. Check those days in Reports once the first sync lands.');
}
console.log('\nThen run scripts/tips-diagnose.sh - Avalon should start showing days');
console.log("with source 'lightspeed' rather than only 'lightspeed-email'.");
await prisma.$disconnect();
JSEOF

(cd "$DEPLOY_DIR" && docker compose exec -T -w /workspace/apps/api \
  -e "CONFIRM=${CONFIRM:-}" \
  -e "LOOKBACK=${LOOKBACK:-3}" \
  "$SERVICE" node "$SCRIPT_IN_CONTAINER")
