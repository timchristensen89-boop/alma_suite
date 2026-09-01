#!/usr/bin/env bash
set -euo pipefail

# Take old SUBMITTED stocktakes out of the review queue, without applying them.
#
# Twenty-six counts going back to August 2025 are sitting in the review queue,
# most of them historical records imported from Loaded. Every one is one click
# from being approved, and approving SETS on-hand to the counted figure rather
# than adjusting by it — so approving a 2025 count rewrites today's stock with
# last year's numbers, silently, across every line on the sheet.
#
# Closing them out means moving them to LOCKED. That is a status change and
# nothing else:
#
#   * It does NOT apply the count. Nothing calls applyStocktake, no
#     InventoryMovement is written, no on-hand is touched. reviewStocktake and
#     lockStocktake only set status and timestamps - checked in
#     stocktakes.service.ts before this script was written.
#   * LOCKED is where historical records are SUPPOSED to live. The Loaded
#     importer already lands them there: "Historical stocktakes land as LOCKED
#     sessions ... so reports treat them as authoritative but they can't be
#     edited without a manager reopen + reason". These are the ones that missed
#     that, so this puts them where their siblings already are.
#   * It cannot displace a newer count. Everywhere reports read a locked count
#     they take the latest by countedAt (stocktakes.service.ts and
#     reports.service.ts both orderBy countedAt desc), so a 2025 count locked
#     today stays behind every 2026 one.
#   * It is reversible. A manager can reopen any of them with a reason.
#
# THE ONE REAL EFFECT worth knowing: for a MONTH that currently has no locked
# count at a venue, locking one makes it the count reports use for that
# month's stock value. That is usually the point - the historical record
# becoming the historical record - but it does change reported figures for
# those months. The dry run flags every stocktake where that applies with
# BECOMES-LATEST so it is a decision, not a surprise.
#
# Dry run by default. Nothing is written without CONFIRM=YES.
#
#   cd /opt/alma/alma-suite && ./scripts/close-out-stale-stocktakes.sh
#       ...what would change, and what would not.
#
#   DAYS=60 ./scripts/close-out-stale-stocktakes.sh
#       ...how old a count has to be to qualify. Default 60. A count younger
#       than this is never touched, whatever else is set - that is the guard
#       that keeps this off the counts the venue is working on right now.
#
#   ONLY_IMPORTED=YES ./scripts/close-out-stale-stocktakes.sh
#       ...only ones carrying an importSource, leaving anything a person
#       typed alone.
#
#   CONFIRM=YES ./scripts/close-out-stale-stocktakes.sh
#       ...do it.

DEPLOY_DIR="${DEPLOY_DIR:-/opt/alma/deploy}"
CONFIRM_FLAG="${CONFIRM:-NO}"
DAYS_FLAG="${DAYS:-60}"
ONLY_IMPORTED_FLAG="${ONLY_IMPORTED:-NO}"

SERVICE="${SERVICE:-}"
if [ -z "$SERVICE" ]; then
  SERVICE="$( (cd "$DEPLOY_DIR" && docker compose ps --services) | grep -E '^(stock-api|suite-api|api)$' | head -1 || true )"
fi
if [ -z "$SERVICE" ]; then
  echo "Could not find an API service in $DEPLOY_DIR." >&2
  (cd "$DEPLOY_DIR" && docker compose ps --services) >&2
  exit 1
fi

echo "-> API service: ${SERVICE}"
echo "-> Older than:  ${DAYS_FLAG} days"
if [ "$CONFIRM_FLAG" = "YES" ]; then
  echo "-> Mode:        WRITE - status will be set to LOCKED"
else
  echo "-> Mode:        DRY RUN - nothing will be written"
fi
echo

SCRIPT_IN_CONTAINER="/workspace/apps/stock-api/.close-out-stale.mjs"

(cd "$DEPLOY_DIR" && docker compose exec -T "$SERVICE" sh -c "cat > $SCRIPT_IN_CONTAINER") <<'JSEOF'
import { prisma } from '@alma/db';

const CONFIRM = process.env.CONFIRM === 'YES';
const ONLY_IMPORTED = process.env.ONLY_IMPORTED === 'YES';
const DAYS = Number(process.env.DAYS ?? '60');
if (!Number.isFinite(DAYS) || DAYS < 1) {
  console.log(`DAYS must be a positive number, got ${process.env.DAYS}`);
  await prisma.$disconnect();
  process.exit(1);
}

const money = (c) =>
  c === null || c === undefined
    ? '-'
    : `$${(c / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pad = (v, w) => { const t = String(v ?? ''); return t.length >= w ? t : t + ' '.repeat(w - t.length); };
const padLeft = (v, w) => { const t = String(v ?? ''); return t.length >= w ? t : ' '.repeat(w - t.length) + t; };
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'no date');

const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

// The guard. A count younger than the cutoff is never a candidate, whatever
// else is set: the venue is working on those right now.
const candidates = await prisma.stocktake.findMany({
  where: {
    status: 'SUBMITTED',
    appliedAt: null,
    countedAt: { lt: cutoff }
  },
  orderBy: [{ countedAt: 'desc' }],
  include: { _count: { select: { lines: true } }, lines: { select: { stockValueCents: true } } }
});

const wanted = ONLY_IMPORTED ? candidates.filter((s) => s.importSource) : candidates;

// What is NOT being touched, so the exclusion is visible rather than implied.
const recent = await prisma.stocktake.count({
  where: { status: 'SUBMITTED', appliedAt: null, countedAt: { gte: cutoff } }
});
const applied = await prisma.stocktake.count({
  where: { status: 'SUBMITTED', appliedAt: { not: null } }
});

console.log(`SUBMITTED, counted before ${day(cutoff)}: ${candidates.length}`);
if (ONLY_IMPORTED) console.log(`  of those, carrying an importSource: ${wanted.length}`);
console.log(`LEFT ALONE: ${recent} counted in the last ${DAYS} days, ${applied} already applied\n`);

if (wanted.length === 0) {
  console.log('Nothing to close out.');
  await prisma.$disconnect();
  process.exit(0);
}

// For each venue, the newest count already LOCKED. Anything older than that
// cannot change what reports read; anything newer becomes the venue's latest.
const venues = [...new Set(wanted.map((s) => s.venue).filter(Boolean))];
const latestLockedByVenue = new Map();
for (const v of venues) {
  const row = await prisma.stocktake.findFirst({
    where: { venue: v, status: 'LOCKED' },
    orderBy: [{ countedAt: 'desc' }],
    select: { id: true, name: true, countedAt: true }
  });
  latestLockedByVenue.set(v, row);
}

const becomesLatest = [];
console.log(`WOULD LOCK (${wanted.length})`);
for (const s of wanted) {
  const value = s.lines.reduce((sum, l) => sum + (l.stockValueCents ?? 0), 0);
  const newest = s.venue ? latestLockedByVenue.get(s.venue) : null;
  const wouldLead = !newest || new Date(s.countedAt) > new Date(newest.countedAt);
  if (wouldLead) becomesLatest.push(s);
  console.log(
    `  ${pad(s.id, 26)} ${pad(s.venue ?? 'no venue', 13)} ${day(s.countedAt)} ` +
    `${padLeft(s._count.lines, 5)} lines ${padLeft(money(value), 14)}  ${s.importSource ? 'imported' : 'typed   '}  ` +
    `${wouldLead ? 'BECOMES-LATEST  ' : '                '}${s.name}`
  );
}

if (becomesLatest.length) {
  console.log(`\nBECOMES-LATEST (${becomesLatest.length}) - read this before confirming`);
  console.log('  These are newer than any count currently LOCKED at their venue, so locking');
  console.log('  them makes reports read THEM for stock value on their date. That is the');
  console.log('  historical record doing its job, but it does move reported figures.');
  for (const s of becomesLatest) {
    const newest = s.venue ? latestLockedByVenue.get(s.venue) : null;
    console.log(`      ${pad(s.venue ?? 'no venue', 13)} ${day(s.countedAt)}  ${s.name}`);
    console.log(`          currently latest locked at this venue: ${newest ? `${day(newest.countedAt)} ${newest.name}` : 'NONE'}`);
  }
  console.log('\n  To leave these and close out only the ones that change nothing, re-run');
  console.log('  with a larger DAYS so they fall outside the window, or lock them by hand.');
}

if (!CONFIRM) {
  console.log('\nDRY RUN - nothing was written. Re-run with CONFIRM=YES to lock them.');
  console.log('No stock is touched either way: this sets status only, it never applies a count.');
  await prisma.$disconnect();
  process.exit(0);
}

// Status only. Deliberately not applyStocktake, not a movement, not a line
// edit - the whole point is that these never reach on-hand.
const now = new Date();
const result = await prisma.stocktake.updateMany({
  where: { id: { in: wanted.map((s) => s.id) }, status: 'SUBMITTED', appliedAt: null },
  data: { status: 'LOCKED', lockedAt: now }
});

console.log(`\nLocked ${result.count} stocktake(s). No stock was touched.`);
console.log('Any of them can be reopened by a manager with a reason if one is needed again.');
const left = await prisma.stocktake.count({ where: { status: 'SUBMITTED', appliedAt: null } });
console.log(`Still SUBMITTED and waiting for review: ${left}`);
await prisma.$disconnect();
JSEOF

(cd "$DEPLOY_DIR" && docker compose exec -T -w /workspace/apps/stock-api \
  -e "CONFIRM=$CONFIRM_FLAG" \
  -e "DAYS=$DAYS_FLAG" \
  -e "ONLY_IMPORTED=$ONLY_IMPORTED_FLAG" \
  "$SERVICE" node "$SCRIPT_IN_CONTAINER")
