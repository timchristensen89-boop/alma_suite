#!/usr/bin/env bash
set -euo pipefail

# What a batched cocktail actually makes, in millilitres.
#
# THE PROBLEM THIS EXISTS FOR
#
# Dirk counted the bar's pre-batched cocktails the only way anyone sensibly
# can: he took the bottles off the shelf and read the volume off the side.
# Millilitres. But every batch recipe in the book yields PORTIONS —
#
#     Beach, Please Batch      makes 18.53 portions
#     Classic Margarita Batch  makes 25 portions
#     Espresso Martini Batch   makes 46.67 portions
#
# — and there is no arithmetic from millilitres to portions. Nothing knows how
# big a portion is. So the count runs, the line saves, the screen says it
# worked, and the batch books NOTHING. Seven of Dirk's thirteen lines land
# here. That is the whole reason the bar's batched stock is invisible.
#
# The fix is one number per recipe: what one batch makes, in mL. This prints
# that number, worked out from the recipe's own ingredients, along with
# everything needed to check it.
#
# HOW THE NUMBER IS WORKED OUT, AND WHY IT LEANS THE WAY IT DOES
#
# Add up the volume of everything that goes in. A batch built from 4,500 mL of
# liquid holds about 4,500 mL. That is mass balance, and it is the same method
# estimate-recipe-yields used for the kitchen.
#
# It has one bias, and it is worth being blunt about which way it points.
# Counting books  (counted ÷ yield) × ingredients  back into stock. So:
#
#   yield too HIGH -> books too LITTLE -> variance looks worse than it is. Safe.
#   yield too LOW  -> books too MUCH  -> invents stock. NOT safe.
#
# Summing ingredients is too LOW exactly when the bottle holds something the
# recipe does not list — and for a batched cocktail that thing is water. Bars
# batch with dilution built in; costing sheets leave water off because water
# is free. A recipe that pours 4,500 mL of spirits and then adds 1,500 mL of
# water to the bottle really makes 6,000 mL, and a 4,500 mL yield would book
# every count 33% heavy.
#
# So this script does not quietly write a number. It shows the sum, shows
# every line that went into it, and shouts when no water or dilution line is
# present — because that is the case where the sum is wrong in the direction
# that matters. Somebody who knows what goes in the bottle has to look.
#
#   ./scripts/batch-yield-sheet.sh
#       every portions-yielding batch recipe, with its mL sum.
#
#   TITLES="Beach, Please Batch,Ginger Spice Batch" ./scripts/batch-yield-sheet.sh
#       just these.
#
#   ALL=YES ./scripts/batch-yield-sheet.sh
#       every prep recipe, not only the ones titled "Batch".
#
#   CONFIRM=YES ./scripts/batch-yield-sheet.sh
#       write the sums as mL yields. Only touches recipes that yield portions
#       AND have a dilution line, because those are the only ones the sum is
#       trustworthy for. Everything else is printed and left alone.

DEPLOY_DIR="${DEPLOY_DIR:-/opt/alma/deploy}"
CONFIRM="${CONFIRM:-NO}"

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
if [ "$CONFIRM" = "YES" ]; then
  echo "-> Mode:        WRITE - safe yields will be set"
else
  echo "-> Mode:        READ ONLY - nothing is written"
fi
echo

SCRIPT_IN_CONTAINER="/workspace/apps/stock-api/.batch-yield-sheet.mjs"

(cd "$DEPLOY_DIR" && docker compose exec -T "$SERVICE" sh -c "cat > $SCRIPT_IN_CONTAINER") <<'JSEOF'
import { prisma } from '@alma/db';
import { normaliseUnitLabel, convertBetweenUnits } from '@alma/shared';

const CONFIRM = process.env.CONFIRM === 'YES';
const ALL = process.env.ALL === 'YES';
const ONLY = new Set(
  (process.env.TITLES ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean)
);

function pad(v, w) { const t = String(v ?? ''); return t.length >= w ? t : t + ' '.repeat(w - t.length); }
function padLeft(v, w) { const t = String(v ?? ''); return t.length >= w ? t : ' '.repeat(w - t.length) + t; }
const norm = (v) => (v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const ml = (v) => `${Number(v.toFixed(v < 100 ? 1 : 0)).toLocaleString('en-AU')} mL`;

// The "(N portions)" rows are a yield note that the Loaded import turned into
// an ingredient. They are not liquid and must not be summed. Same shape as the
// portion-line rule the costing already applies.
const PORTION_LINE_RE = /\b(portion|portions|serves|serving|yields?|makes)\b/i;

// Water under any of its bar names. Its presence is the difference between a
// yield that can be trusted and one that is a guess — see the header.
const DILUTION_RE = /\b(water|h2o|dilution|filtered|still water|ice)\b/i;

const recipes = await prisma.recipe.findMany({
  where: { status: 'ACTIVE', isPrepRecipe: true },
  select: {
    id: true, title: true, venue: true,
    yieldQuantity: true, yieldUnit: true,
    lines: {
      select: { ingredientName: true, quantity: true, unit: true, costingOnly: true },
      orderBy: { position: 'asc' }
    }
  },
  orderBy: { title: 'asc' }
});

const chosen = recipes.filter((r) => {
  if (ONLY.size > 0) return ONLY.has(norm(r.title));
  if (ALL) return true;
  return /batch/i.test(r.title);
});

if (chosen.length === 0) {
  console.log('No recipes matched. Try ALL=YES, or check the TITLES spelling.');
  await prisma.$disconnect();
  process.exit(0);
}

// A yield unit that normalises to 'each' is a count of servings — portions,
// serves, servings all land there. That is the unit that cannot be counted
// off a measuring jug, and the only one this script is trying to replace.
const yieldsPortions = (r) => {
  const u = normaliseUnitLabel(r.yieldUnit);
  return u === 'each' || u === '';
};

const rows = [];
for (const r of chosen) {
  let volumeMl = 0;
  const volumeLines = [];
  const otherLines = [];
  let hasDilution = false;

  for (const line of r.lines) {
    const name = (line.ingredientName ?? '').trim();
    if (line.costingOnly) continue;
    if (PORTION_LINE_RE.test(name)) continue;   // the import artefact
    if (DILUTION_RE.test(name)) hasDilution = true;

    const qty = typeof line.quantity === 'number' ? line.quantity : null;
    const unit = normaliseUnitLabel(line.unit);
    const asMl = qty !== null && unit ? convertBetweenUnits(qty, unit, 'ml') : null;

    if (asMl !== null && Number.isFinite(asMl) && asMl > 0) {
      volumeMl += asMl;
      volumeLines.push({ name, qty, unit, asMl });
    } else {
      otherLines.push({ name, qty, unit });
    }
  }

  rows.push({ recipe: r, volumeMl, volumeLines, otherLines, hasDilution });
}

const needsFixing = rows.filter((row) => yieldsPortions(row.recipe));
const alreadyFine = rows.filter((row) => !yieldsPortions(row.recipe));

// ---- the ones that book nothing today -----------------------------------
console.log(`COUNTED IN mL, YIELDS PORTIONS - BOOKS NOTHING (${needsFixing.length})`);
if (needsFixing.length === 0) {
  console.log('  (none)');
} else {
  console.log('  Each of these needs one number: what one batch makes, in mL.');
  console.log('  The sum below is every liquid ingredient added up.\n');
}
for (const row of needsFixing) {
  const r = row.recipe;
  const current = r.yieldQuantity ? `${r.yieldQuantity} ${r.yieldUnit ?? ''}`.trim() : 'no yield set';
  console.log(`  ${r.title}${r.venue ? `  (${r.venue})` : ''}`);
  console.log(`      now: makes ${current}`);
  if (row.volumeMl > 0) {
    console.log(`      sum: ${ml(row.volumeMl)} of liquid across ${row.volumeLines.length} line(s)`);
    for (const l of row.volumeLines) {
      console.log(`             ${pad(l.name, 34)} ${padLeft(l.qty, 8)} ${pad(l.unit, 4)} = ${ml(l.asMl)}`);
    }
  } else {
    console.log('      sum: NOTHING - no ingredient line carries a volume, so there is');
    console.log('           nothing to add up. This one has to be measured by hand.');
  }
  for (const l of row.otherLines) {
    console.log(`      not liquid, excluded: ${pad(l.name, 30)} ${padLeft(l.qty ?? '-', 8)} ${l.unit || '(no unit)'}`);
  }
  if (row.volumeMl > 0 && !row.hasDilution) {
    console.log('      *** NO WATER OR DILUTION LINE. If the bar tops this batch up with');
    console.log('          water, the bottle holds MORE than the sum, and using the sum as');
    console.log('          the yield books every count HEAVY - it invents stock. Measure a');
    console.log('          full batch, or add the water to the recipe, before trusting it.');
  }
  console.log();
}

// ---- the ones already countable -----------------------------------------
console.log(`ALREADY YIELDS A MEASURE (${alreadyFine.length}) - these count fine`);
if (alreadyFine.length === 0) {
  console.log('  (none)');
}
for (const row of alreadyFine) {
  const r = row.recipe;
  const drift =
    row.volumeMl > 0 && r.yieldQuantity
      ? (() => {
          const yieldMl = convertBetweenUnits(r.yieldQuantity, r.yieldUnit, 'ml');
          if (yieldMl === null || yieldMl <= 0) return '';
          const pct = Math.round(((row.volumeMl - yieldMl) / yieldMl) * 100);
          return Math.abs(pct) >= 15 ? `   (ingredients sum to ${ml(row.volumeMl)}, ${pct > 0 ? '+' : ''}${pct}%)` : '';
        })()
      : '';
  console.log(`  ${pad(r.title, 34)} makes ${r.yieldQuantity ?? '-'} ${r.yieldUnit ?? ''}${drift}`);
}
console.log();

// ---- write ---------------------------------------------------------------
// Only where the sum is defensible: the recipe yields portions today, it has
// liquid to add up, and it names its dilution. Anything without a water line
// is left for a person, because that is the case that books heavy.
const writable = needsFixing.filter((row) => row.volumeMl > 0 && row.hasDilution);
const heldBack = needsFixing.filter((row) => row.volumeMl > 0 && !row.hasDilution);

if (!CONFIRM) {
  console.log('READ ONLY - nothing was written.');
  console.log(`Re-running with CONFIRM=YES would set an mL yield on ${writable.length} recipe(s):`);
  for (const row of writable) console.log(`  ${pad(row.recipe.title, 34)} -> ${ml(row.volumeMl)}`);
  if (heldBack.length > 0) {
    console.log(`\nand would LEAVE ALONE ${heldBack.length} with no dilution line, because the sum`);
    console.log('would book them heavy. Set those by hand in Stock -> Recipes:');
    for (const row of heldBack) console.log(`  ${pad(row.recipe.title, 34)}    sum is ${ml(row.volumeMl)}, real batch is probably more`);
  }
} else {
  for (const row of writable) {
    await prisma.recipe.update({
      where: { id: row.recipe.id },
      data: { yieldQuantity: Number(row.volumeMl.toFixed(2)), yieldUnit: 'ml' }
    });
    console.log(`set ${pad(row.recipe.title, 34)} -> ${ml(row.volumeMl)}`);
  }
  console.log(`\nSet ${writable.length} yield(s). Left ${heldBack.length} alone (no dilution line).`);
  console.log('Re-run scripts/add-bar-batches.sh - the fixed ones will now book.');
}

await prisma.$disconnect();
JSEOF

(cd "$DEPLOY_DIR" && docker compose exec -T \
  -e CONFIRM="${CONFIRM}" \
  -e ALL="${ALL:-}" \
  -e TITLES="${TITLES:-}" \
  "$SERVICE" node "$SCRIPT_IN_CONTAINER")
