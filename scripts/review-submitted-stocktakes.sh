#!/usr/bin/env bash
set -euo pipefail

# What is sitting in the review queue, and what approving it would do.
#
# A SUBMITTED stocktake has not touched stock yet. Approving it does, in one
# irreversible-ish step: every counted line SETS that item's on-hand to the
# counted number, and the difference becomes a movement. So the questions
# worth answering before anyone clicks approve are all about what is about to
# change and whether any of it is a mistake rather than a count.
#
# It writes nothing.
#
#   cd /opt/alma/alma-suite && ./scripts/review-submitted-stocktakes.sh
#
# Four things it looks for:
#
#  1. BLANK LINES. On a count submitted BEFORE the blank-is-zero change, a
#     blank line is skipped on apply — the item silently keeps the on-hand it
#     had last time. An empty shelf left blank therefore carries yesterday's
#     phantom stock forward. These are the lines to look at first.
#  2. IMPLAUSIBLE LINES. One line worth an absurd share of the whole count is
#     not wealth, it is a unit mistake (21,725 "bottles" of gin). Same rule the
#     Stock app uses, from @alma/shared.
#  3. THE BIGGEST MOVES. What applying would actually change, largest first.
#  4. PREPPED ITEMS. Whether any prep lines are on the sheet, and what they
#     would book.

DEPLOY_DIR="${DEPLOY_DIR:-/opt/alma/deploy}"

SERVICE="${SERVICE:-}"
if [ -z "$SERVICE" ]; then
  SERVICE="$( (cd "$DEPLOY_DIR" && docker compose ps --services) | grep -E '^(stock-api|suite-api|api)$' | head -1 || true )"
fi
if [ -z "$SERVICE" ]; then
  echo "Could not find an API service in $DEPLOY_DIR." >&2
  (cd "$DEPLOY_DIR" && docker compose ps --services) >&2
  echo "Re-run with SERVICE=<name>." >&2
  exit 1
fi

echo "-> API service: ${SERVICE}"
echo "-> Mode:        READ ONLY - nothing is written"
echo

SCRIPT_IN_CONTAINER="/workspace/apps/stock-api/.review-submitted.mjs"

(cd "$DEPLOY_DIR" && docker compose exec -T "$SERVICE" sh -c "cat > $SCRIPT_IN_CONTAINER") <<'JSEOF'
import { prisma } from '@alma/db';
import { implausibleCountLines } from '@alma/shared';

const money = (cents) =>
  cents === null || cents === undefined
    ? '-'
    : `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function pad(value, width) {
  const text = String(value ?? '');
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}
function padLeft(value, width) {
  const text = String(value ?? '');
  return text.length >= width ? text : ' '.repeat(width - text.length) + text;
}

const submitted = await prisma.stocktake.findMany({
  where: { status: 'SUBMITTED' },
  orderBy: { countedAt: 'desc' },
  include: {
    lines: {
      orderBy: [{ position: 'asc' }],
      include: {
        item: {
          select: {
            id: true, name: true, unit: true, countUnit: true, conversionFactor: true,
            onHand: true, avgCostCents: true, measurePerCountUnit: true, measureUnit: true
          }
        },
        recipe: { select: { id: true, title: true, yieldQuantity: true, yieldUnit: true } }
      }
    }
  }
});

if (submitted.length === 0) {
  console.log('No stocktakes are waiting for review.');
  await prisma.$disconnect();
  process.exit(0);
}

console.log(`${submitted.length} STOCKTAKE(S) SUBMITTED AND WAITING FOR APPROVAL\n`);

// Per-venue on-hand is what apply actually reads; the item-level number is the
// sum across venues, so judging a venue's count against it overstates every
// variance. Load the venue rows once.
const venues = [...new Set(submitted.map((s) => s.venue).filter(Boolean))];
const itemIds = [...new Set(submitted.flatMap((s) => s.lines.map((l) => l.itemId).filter(Boolean)))];
const venueRows = venues.length && itemIds.length
  ? await prisma.venueStockItem.findMany({
      where: { venue: { in: venues }, stockItemId: { in: itemIds } },
      select: { venue: true, stockItemId: true, onHand: true }
    })
  : [];
const venueOnHand = new Map(venueRows.map((r) => [`${r.venue}:${r.stockItemId}`, r.onHand]));
const onHandFor = (stocktake, line) => {
  if (!line.itemId) return null;
  if (stocktake.venue) {
    const v = venueOnHand.get(`${stocktake.venue}:${line.itemId}`);
    // A venue row with a null on-hand has never been counted here: its prior
    // holding is zero, not the group total.
    return v ?? 0;
  }
  return line.item?.onHand ?? 0;
};

for (const s of submitted) {
  const counted = s.lines.filter((l) => l.countedQty !== null);
  const blank = s.lines.filter((l) => l.countedQty === null);
  const prep = s.lines.filter((l) => l.recipeId);
  const totalValue = s.lines.reduce((sum, l) => sum + (l.stockValueCents ?? 0), 0);

  console.log('='.repeat(78));
  console.log(`${s.name}`);
  console.log(`  venue ${s.venue ?? '(none)'} · counted ${s.countedAt.toISOString().slice(0, 10)} · submitted ${s.submittedAt ? s.submittedAt.toISOString().slice(0, 16).replace('T', ' ') : '?'}`);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  console.log(`  ${plural(s.lines.length, 'line', 'lines')} · ${counted.length} counted · ${blank.length} blank · value ${money(totalValue)}`);
  console.log('='.repeat(78));

  // 1. BLANKS -------------------------------------------------------------
  if (blank.length === 0) {
    console.log('\nBLANK LINES: none. Every line on the sheet carries a count.');
  } else {
    const stale = blank.filter((l) => l.itemId && (onHandFor(s, l) ?? 0) !== 0);
    console.log(`\nBLANK LINES: ${blank.length}`);
    console.log('  This count was submitted with blanks left in. Approving SKIPS them, so');
    console.log('  each of these items keeps the on-hand it already has - an empty shelf');
    console.log('  left blank carries its old number forward instead of going to zero.');
    if (stale.length) {
      console.log(`\n  ${stale.length} of them ${stale.length === 1 ? 'currently holds' : 'currently hold'} stock that will be left untouched:`);
      const worst = stale
        .map((l) => ({ l, onHand: onHandFor(s, l), value: Math.round((onHandFor(s, l) ?? 0) * (l.item?.avgCostCents ?? 0)) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 15);
      for (const row of worst) {
        console.log(`      ${pad(row.l.label, 40)} keeps ${padLeft(row.onHand, 10)} ${pad(row.l.item?.countUnit ?? row.l.item?.unit ?? '', 8)} ${padLeft(money(row.value), 12)}`);
      }
      if (stale.length > worst.length) console.log(`      ... and ${stale.length - worst.length} more`);
    } else {
      console.log('  All of them are already at zero, so nothing is carried forward.');
    }
  }

  // 2. IMPLAUSIBLE --------------------------------------------------------
  const scaleLines = counted
    .filter((l) => l.itemId && l.item)
    .map((l) => ({
      itemId: l.itemId,
      itemName: l.item.name,
      venue: s.venue,
      countedQty: l.countedQty,
      unitCostCents: l.item.avgCostCents,
      countUnit: l.item.countUnit ?? l.item.unit,
      measurePerCountUnit: l.item.measurePerCountUnit,
      measureUnit: l.item.measureUnit
    }));
  const implausible = implausibleCountLines(scaleLines);
  console.log(`\nIMPLAUSIBLE LINES: ${implausible.length}`);
  if (implausible.length === 0) {
    console.log('  No single line is worth an absurd share of the count.');
  } else {
    console.log('  A line worth this much of the whole count is a unit mistake, not stock:');
    for (const row of implausible) console.log(`      ${row.message}`);
  }

  // 3. BIGGEST MOVES ------------------------------------------------------
  const moves = counted
    .filter((l) => l.itemId && l.item)
    .map((l) => {
      const before = onHandFor(s, l) ?? 0;
      const delta = l.countedQty - before;
      return {
        label: l.label,
        unit: l.item.countUnit ?? l.item.unit,
        before,
        after: l.countedQty,
        delta,
        valueCents: Math.round(delta * (l.item.avgCostCents ?? 0))
      };
    })
    .filter((m) => Math.abs(m.delta) > 0.0001)
    .sort((a, b) => Math.abs(b.valueCents) - Math.abs(a.valueCents));

  const netCents = moves.reduce((sum, m) => sum + m.valueCents, 0);
  console.log(`\nWHAT APPROVING WOULD CHANGE: ${moves.length} ${moves.length === 1 ? 'item moves' : 'items move'} · net ${money(netCents)}`);
  for (const m of moves.slice(0, 15)) {
    const sign = m.delta > 0 ? '+' : '';
    console.log(`      ${pad(m.label, 40)} ${padLeft(m.before, 10)} -> ${padLeft(m.after, 10)} ${pad(m.unit, 8)} ${padLeft(sign + m.delta.toFixed(3), 12)} ${padLeft(money(m.valueCents), 12)}`);
  }
  if (moves.length > 15) console.log(`      ... and ${moves.length - 15} more`);

  // 4. PREPPED ITEMS ------------------------------------------------------
  console.log(`\nPREPPED ITEMS ON THIS SHEET: ${prep.length}`);
  if (prep.length === 0) {
    console.log('  None. Anything the kitchen had already made is not in this count.');
  } else {
    for (const l of prep) {
      console.log(`      ${pad(l.label, 40)} ${padLeft(l.countedQty ?? '(blank)', 10)} ${l.unit ?? ''}  -> ${l.recipe?.title ?? 'recipe missing'}`);
    }
    console.log('  Run the prep preview for the full explosion:');
    console.log(`      GET /api/stocktake/${s.id}/prep-preview`);
  }
  console.log();
}

console.log('Nothing was written. Approve in Stock -> Stocktake once the above looks right.');
await prisma.$disconnect();
JSEOF

(cd "$DEPLOY_DIR" && docker compose exec -T -w /workspace/apps/stock-api "$SERVICE" node "$SCRIPT_IN_CONTAINER")
