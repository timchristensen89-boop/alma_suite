#!/usr/bin/env bash
set -euo pipefail

# Twenty-six counts are stuck in the review queue. None of them is waiting for
# a decision - every one was applied months ago.
#
# applyStocktake stamped appliedAt and reviewedAt and never moved `status`, so
# a count that had been approved, had its stock written, and was finished in
# every way that matters still read as SUBMITTED for ever. The queue was
# showing twenty-six counts awaiting review when the true number was zero.
#
# THE RISK I FIRST ASSUMED WAS NOT THERE. These are not one click from
# rewriting today's stock with last year's numbers: applyStocktake refuses an
# already-applied count twice over, at an explicit `if (stocktake.appliedAt)`
# and again at the `appliedAt: null` guard on its own updateMany. What was
# broken was the queue, not the ledger.
#
# So this is a backfill, not a rescue. It moves applied-but-SUBMITTED counts
# to REVIEWED, which is what applyStocktake now sets going forward.
#
# REVIEWED rather than LOCKED, deliberately:
#
#   * It is what actually happened. reviewedAt is already stamped on every one
#     of these; only the status field disagrees.
#   * It does not touch reporting. Reports read the latest LOCKED count at a
#     venue - REVIEWED is invisible to them, so no figure moves. Locking would
#     have been a second, separate decision about which counts reports trust,
#     and it is not this script's to make.
#   * LOCKED is still available afterwards, by hand, for anything that wants it.
#
# Nothing here applies a count, writes a movement, or touches on-hand. A count
# that has NOT been applied is never selected: those are real pending work.
#
#   cd /opt/alma/alma-suite && ./scripts/close-out-stale-stocktakes.sh
#       ...what is stuck, and what is genuinely still pending.
#
#   CONFIRM=YES ./scripts/close-out-stale-stocktakes.sh
#       ...move them to REVIEWED.

DEPLOY_DIR="${DEPLOY_DIR:-/opt/alma/deploy}"
CONFIRM_FLAG="${CONFIRM:-NO}"

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
if [ "$CONFIRM_FLAG" = "YES" ]; then
  echo "-> Mode:        WRITE - applied counts move to REVIEWED"
else
  echo "-> Mode:        DRY RUN - nothing will be written"
fi
echo

SCRIPT_IN_CONTAINER="/workspace/apps/stock-api/.close-out-stale.mjs"

(cd "$DEPLOY_DIR" && docker compose exec -T "$SERVICE" sh -c "cat > $SCRIPT_IN_CONTAINER") <<'JSEOF'
import { prisma } from '@alma/db';

const CONFIRM = process.env.CONFIRM === 'YES';

const money = (c) =>
  c === null || c === undefined
    ? '-'
    : `$${(c / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pad = (v, w) => { const t = String(v ?? ''); return t.length >= w ? t : t + ' '.repeat(w - t.length); };
const padLeft = (v, w) => { const t = String(v ?? ''); return t.length >= w ? t : ' '.repeat(w - t.length) + t; };
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '-');

// Applied, but the status was never moved off SUBMITTED. Finished work that
// still looks pending.
const stuck = await prisma.stocktake.findMany({
  where: { status: 'SUBMITTED', appliedAt: { not: null } },
  orderBy: [{ countedAt: 'desc' }],
  include: { _count: { select: { lines: true } }, lines: { select: { stockValueCents: true } } }
});

// Never applied. Real pending work - not this script's business, but worth
// naming so the queue's true size is visible.
const pending = await prisma.stocktake.findMany({
  where: { status: 'SUBMITTED', appliedAt: null },
  orderBy: [{ countedAt: 'desc' }],
  select: { id: true, venue: true, countedAt: true, name: true, _count: { select: { lines: true } } }
});

console.log(`APPLIED BUT STILL SUBMITTED (${stuck.length}) - finished, stuck in the queue`);
if (!stuck.length) console.log('  (none)');
for (const s of stuck) {
  const value = s.lines.reduce((sum, l) => sum + (l.stockValueCents ?? 0), 0);
  console.log(
    `  ${pad(s.venue ?? 'no venue', 13)} counted ${day(s.countedAt)}  applied ${day(s.appliedAt)}  ` +
    `${padLeft(s._count.lines, 5)} lines ${padLeft(money(value), 14)}  ${s.name}`
  );
}

console.log(`\nGENUINELY WAITING FOR REVIEW (${pending.length}) - not touched`);
if (!pending.length) console.log('  (none)');
for (const s of pending) {
  console.log(`  ${pad(s.venue ?? 'no venue', 13)} counted ${day(s.countedAt)}  ${padLeft(s._count.lines, 5)} lines  ${s.name}`);
}

if (!stuck.length) {
  console.log('\nNothing stuck. The queue is telling the truth.');
  await prisma.$disconnect();
  process.exit(0);
}

if (!CONFIRM) {
  console.log('\nDRY RUN - nothing was written.');
  console.log('Moving these to REVIEWED changes a status field and nothing else: their stock');
  console.log('was written when they were applied, and reports read LOCKED counts, not');
  console.log('REVIEWED ones, so no reported figure moves.');
  console.log('Re-run with CONFIRM=YES to do it.');
  await prisma.$disconnect();
  process.exit(0);
}

// Status only, and only where appliedAt is genuinely set - the same condition
// that was displayed above, re-asserted at write time so a count applied
// between the read and the write cannot slip through unexamined.
const result = await prisma.stocktake.updateMany({
  where: { id: { in: stuck.map((s) => s.id) }, status: 'SUBMITTED', appliedAt: { not: null } },
  data: { status: 'REVIEWED' }
});

console.log(`\nMoved ${result.count} applied count(s) to REVIEWED. No stock was touched.`);
const left = await prisma.stocktake.count({ where: { status: 'SUBMITTED' } });
const stillStuck = await prisma.stocktake.count({ where: { status: 'SUBMITTED', appliedAt: { not: null } } });
console.log(`Review queue now: ${left} SUBMITTED (${stillStuck} of them applied).`);
await prisma.$disconnect();
JSEOF

(cd "$DEPLOY_DIR" && docker compose exec -T -w /workspace/apps/stock-api \
  -e "CONFIRM=$CONFIRM_FLAG" \
  "$SERVICE" node "$SCRIPT_IN_CONTAINER")
