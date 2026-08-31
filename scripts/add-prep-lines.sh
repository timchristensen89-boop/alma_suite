#!/usr/bin/env bash
set -euo pipefail

# Put the kitchen's prepped items onto a stocktake that was counted without
# them.
#
# The count sheet had nowhere for made items, so the chef wrote twenty-two of
# them out by hand at the bottom and the sheet went in without them. This adds
# them as prepped-item lines, which is what makes approving the count stop
# reading the production fridge as shrinkage.
#
# DRY RUN by default. It writes only with PREP_CONFIRM=YES.
#
#   cd /opt/alma/alma-suite && ./scripts/add-prep-lines.sh
#       ...says exactly what it would add and what it would skip.
#
#   cd /opt/alma/alma-suite && PREP_CONFIRM=YES ./scripts/add-prep-lines.sh
#       ...adds them.
#
#   STOCKTAKE_ID=<id> ./scripts/add-prep-lines.sh
#       ...target a specific count instead of the newest submitted kitchen one.
#
#   SKIP="Bean puree,Octopus Adobo" ./scripts/add-prep-lines.sh
#       ...leave things off. Use this when the dry run shows a match is wrong:
#       the matcher offers a candidate, the kitchen decides. An entry matches
#       either a hand-written name OR a recipe title, and naming the RECIPE is
#       usually what you want — two hand-written names can reach the same
#       recipe, so excluding one name alone just lets the other one through.
#
# EVERY item the chef counted goes on the sheet. What differs is whether it
# books ingredients:
#
#   A PREP LINE, where the recipe can be exploded AND the weight converts to
#   its yield unit. Approving the count books its ingredients back into stock.
#
#   A RECORD-ONLY LINE for the rest — no recipe link, so it books nothing, but
#   the number is on the count instead of in a message. Dropping them would
#   recreate the problem this exists to fix: the only record of 8.884 kg of
#   bean puree would be the note at the bottom of an email. Each one carries
#   the reason it books nothing, so it is a to-do rather than a mystery.
#   RECORD_ONLY=NO leaves them off entirely.

DEPLOY_DIR="${DEPLOY_DIR:-/opt/alma/deploy}"
CONFIRM="${PREP_CONFIRM:-NO}"
# Comma-separated hand-written names to leave off, for when the dry run shows a
# match is wrong. e.g. SKIP="Bean puree,Octopus"
SKIP_LIST="${SKIP:-}"
# Record the items that cannot be exploded as label-only lines. On by default:
# a number the chef measured is worth keeping even when nothing can be booked
# from it.
RECORD_ONLY="${RECORD_ONLY:-YES}"

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
  echo "-> Mode:        WRITE - lines will be added"
else
  echo "-> Mode:        DRY RUN - nothing will be written"
fi
echo

SCRIPT_IN_CONTAINER="/workspace/apps/stock-api/.add-prep-lines.mjs"

(cd "$DEPLOY_DIR" && docker compose exec -T "$SERVICE" sh -c "cat > $SCRIPT_IN_CONTAINER") <<'JSEOF'
import { prisma } from '@alma/db';
import { STOCKTAKE_PREP_AREA } from '@alma/shared';
import {
  batchesForCount,
  explodePrepCount,
  prepCountReadiness
} from './dist/apps/stock-api/src/lib/prep-explosion.js';

const CONFIRM = process.env.PREP_CONFIRM === 'YES';
const RECORD_ONLY = (process.env.RECORD_ONLY ?? 'YES') === 'YES';
const SKIP = new Set(
  (process.env.SKIP ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
);

// Exactly what the chef weighed, in the units she wrote them in.
const COUNTED = [
  ['Mole for broccolini', 7.414, 'kg'],
  ['Salmon pate', 468, 'g'],
  ['Cauliflower puree', 3.01, 'kg'],
  ['Chimichurri', 379, 'g'],
  ['Chipotle mayo', 11.707, 'kg'],
  ['Salsa macha', 2.981, 'kg'],
  ['Habanero salsa', 1.426, 'kg'],
  ['Octopus', 2.099, 'kg'],
  ['Ribs', 30, 'kg'],
  ['Birria', 6, 'kg'],
  ['Chorizo taco filling', 950, 'g'],
  ['Cooked chicken thigh with skin', 2.669, 'kg'],
  ['Sikil pak', 4.126, 'kg'],
  ['Polenta', 6.45, 'kg'],
  ['Morita salsa', 1.25, 'kg'],
  ['Tomatillo salsa', 670, 'g'],
  ['Mushroom filling', 3.809, 'kg'],
  ['Chocolate sauce', 2.233, 'kg'],
  ['Nopal taco filling', 3.748, 'kg'],
  ['Bean puree', 8.884, 'kg'],
  ['Adobo for chicken and octopus', 2.597, 'kg'],
  ['Tinga', 11, 'kg']
];

const STOPWORDS = new Set(['for', 'and', 'the', 'with', 'of', 'a']);
function tokens(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // pate, puree
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
}

// Words are weighted by how rare they are across the recipe book. "Salsa"
// appears everywhere and identifies nothing; "sikil" and "morita" appear
// nowhere and identify everything. A match has to cover most of the WEIGHT of
// the name, not most of its words — otherwise "Habanero salsa" matches
// "Pineapple Salsa" and the wrong tub goes on the sheet.
function buildMatcher(recipes) {
  const df = new Map();
  for (const r of recipes) for (const w of new Set(tokens(r.title))) df.set(w, (df.get(w) ?? 0) + 1);
  const total = recipes.length;
  const weight = (w) => Math.log((total + 1) / ((df.get(w) ?? 0) + 1));
  return (name) => {
    const wanted = [...new Set(tokens(name))];
    const wantedWeight = wanted.reduce((s, w) => s + weight(w), 0);
    if (wantedWeight <= 0) return [];
    const scored = [];
    for (const r of recipes) {
      const have = new Set(tokens(r.title));
      const matched = wanted.filter((w) => have.has(w));
      if (!matched.length) continue;
      const matchedWeight = matched.reduce((s, w) => s + weight(w), 0);
      const leftOver = [...have].filter((w) => !matched.includes(w)).reduce((s, w) => s + weight(w), 0);
      scored.push({ recipe: r, score: matchedWeight / wantedWeight, leftOver });
    }
    return scored.sort((a, b) => b.score - a.score || a.leftOver - b.leftOver);
  };
}
const MATCH_THRESHOLD = 0.6;

const recipeSelect = {
  id: true,
  title: true,
  yieldQuantity: true,
  yieldUnit: true,
  lines: {
    select: { ingredientName: true, quantity: true, unit: true, itemId: true, subRecipeId: true, costingOnly: true },
    orderBy: { position: 'asc' }
  }
};

const stocktake = process.env.STOCKTAKE_ID
  ? await prisma.stocktake.findUnique({
      where: { id: process.env.STOCKTAKE_ID },
      select: { id: true, name: true, venue: true, status: true, appliedAt: true, lines: { select: { id: true, position: true, recipeId: true, itemId: true, label: true } } }
    })
  : await prisma.stocktake.findFirst({
      where: { status: 'SUBMITTED', name: { contains: 'Kitchen' } },
      orderBy: { countedAt: 'desc' },
      select: { id: true, name: true, venue: true, status: true, appliedAt: true, lines: { select: { id: true, position: true, recipeId: true, itemId: true, label: true } } }
    });

if (!stocktake) {
  console.log('No matching stocktake found. Pass STOCKTAKE_ID=<id>.');
  await prisma.$disconnect();
  process.exit(1);
}

console.log(`Stocktake: ${stocktake.name}`);
console.log(`  ${stocktake.venue ?? '(no venue)'} · ${stocktake.status} · ${stocktake.lines.length} lines\n`);

// Applying rewrites stock. Adding lines to a count that has already been
// applied would change what it says AFTER it said it, so that is a refusal
// rather than a warning.
if (stocktake.appliedAt) {
  console.log('This stocktake has already been applied. Adding lines now would change what it');
  console.log('claims after it has already moved stock. Reverse it first, or use a new count.');
  await prisma.$disconnect();
  process.exit(1);
}

const already = new Set(stocktake.lines.map((l) => l.recipeId).filter(Boolean));
// Record-only lines carry no recipe, so the recipe guard above cannot see them.
// Without this a second run would add every one of them again.
const alreadyLabelled = new Set(stocktake.lines.map((l) => (l.label ?? '').trim().toLowerCase()));

const active = await prisma.recipe.findMany({
  where: { status: 'ACTIVE', isPrepRecipe: true },
  select: recipeSelect,
  orderBy: { title: 'asc' }
});
const subIds = [...new Set(active.flatMap((r) => r.lines.map((l) => l.subRecipeId).filter(Boolean)))]
  .filter((id) => !active.some((r) => r.id === id));
const subs = subIds.length
  ? await prisma.recipe.findMany({ where: { id: { in: subIds } }, select: recipeSelect })
  : [];
const specs = new Map([...active, ...subs].map((r) => [r.id, r]));
const itemIds = [...new Set([...specs.values()].flatMap((s) => s.lines.map((l) => l.itemId).filter(Boolean)))];
const items = new Map(
  (
    await prisma.stockItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, name: true, unit: true, countUnit: true, conversionFactor: true, measurePerCountUnit: true, measureUnit: true, avgCostCents: true }
    })
  ).map((i) => [i.id, i])
);

const match = buildMatcher(active);
const toAdd = [];
const skipped = [];
// Two hand-written names can land on the same recipe — "Octopus" and "Adobo
// for chicken and octopus" both reach Octopus Adobo. Adding both would put two
// lines on the sheet for one recipe and book its ingredients TWICE. One line
// per recipe; the second is reported so the mis-match gets looked at rather
// than silently dropped.
const claimed = new Map();

for (const [name, qty, unit] of COUNTED) {
  if (SKIP.has(name.toLowerCase())) {
    skipped.push([name, qty, unit, 'excluded by SKIP']);
    continue;
  }
  const ranked = match(name);
  const best = ranked[0];
  if (!best || best.score < MATCH_THRESHOLD) {
    skipped.push([name, qty, unit, 'no prep recipe matches this name']);
    continue;
  }
  const recipe = specs.get(best.recipe.id);
  // SKIP takes a recipe title as well as a hand-written name, and it has to:
  // excluding "Octopus" alone just hands Octopus Adobo to "Adobo for chicken
  // and octopus" instead, and the same wrong recipe goes on under another
  // name. Naming the recipe shuts it out however it is reached.
  if (SKIP.has(recipe.title.toLowerCase())) {
    skipped.push([name, qty, unit, `excluded by SKIP ("${recipe.title}")`]);
    continue;
  }
  if (already.has(recipe.id)) {
    // NOT recordable. A prep line is written under the RECIPE's title, so on a
    // re-run the chef's own name ("Tinga", "Ribs", "Birria") is not on the
    // sheet even though the line is — and recording it would add a duplicate
    // of something already counted. Caught by running the script twice.
    skipped.push([name, qty, unit, `already on this sheet as "${recipe.title}"`, false]);
    continue;
  }
  const claimedBy = claimed.get(recipe.id);
  if (claimedBy) {
    skipped.push([
      name,
      qty,
      unit,
      `also matched "${recipe.title}", already being added for "${claimedBy}" — adding both would book its ingredients twice`
    ]);
    continue;
  }
  const readiness = prepCountReadiness(recipe, specs, items);
  if (!readiness.countable) {
    skipped.push([name, qty, unit, `"${recipe.title}": ${readiness.problems.join(' ')}`]);
    continue;
  }
  // The decisive check, and the reason this is not just "add 22 lines": the
  // weight has to convert to the recipe's yield unit. A recipe that yields
  // portions cannot be counted off a scale, and a line that cannot convert
  // books nothing while looking exactly like one that worked.
  const { batches, warning } = batchesForCount(qty, unit, recipe);
  if (batches === null) {
    skipped.push([name, qty, unit, warning ?? 'the weight does not convert to this recipe’s yield unit']);
    continue;
  }
  const explosion = explodePrepCount({ countedQty: qty, countedUnit: unit, recipe, recipesById: specs, itemsById: items });
  claimed.set(recipe.id, name);
  toAdd.push({ name, qty, unit, recipe, explosion, verify: !(best.score >= 0.999 && best.leftOver === 0) });
}

const pad = (v, w) => String(v ?? '').padEnd(w);

const money = (c) =>
  c === null || c === undefined ? 'not valued' : `$${(c / 100).toFixed(2)}`;

console.log(`WILL ADD (${toAdd.length})`);
console.log('  "books" is what the ingredients are worth. It is the quickest way to spot a bad');
console.log('  match: a tub should book roughly what its contents cost. Wildly more means the');
console.log('  recipe yield is too small, and the count will invent stock that is not there.\n');
for (const row of toAdd) {
  console.log(
    `  ${pad(row.name, 32)} ${pad(row.qty + ' ' + row.unit, 12)} -> ${pad(row.recipe.title, 28)} ${pad(row.explosion.components.length + ' ingredient(s)', 16)} books ${money(row.explosion.valueCents)}${row.verify ? '   (check this is the right recipe)' : ''}`
  );
  for (const c of row.explosion.components.slice(0, 4)) {
    console.log(`        ${pad(c.itemName, 34)} ${c.quantity} ${c.unit}`);
  }
  if (row.explosion.components.length > 4) console.log(`        ... and ${row.explosion.components.length - 4} more`);
}

// Everything that could not be exploded still goes on the sheet, carrying the
// reason it books nothing.
// Two ways an item is already accounted for: its own label is on the sheet, or
// it was matched to a recipe that is (under that recipe's title, not this one).
const isRecordable = ([name, , , , recordable]) =>
  recordable !== false && !alreadyLabelled.has(name.trim().toLowerCase());
const recordOnly = RECORD_ONLY ? skipped.filter(isRecordable) : [];
const alreadyThere = skipped.filter((row) => !isRecordable(row));
const counted = (qty, unit) => `${qty} ${unit}`;

console.log(`\nWILL RECORD ONLY - ON THE SHEET, BOOKS NOTHING (${recordOnly.length})`);
if (!RECORD_ONLY) {
  console.log('  RECORD_ONLY=NO, so these are left off the sheet entirely:');
} else if (recordOnly.length) {
  console.log('  The number is kept where the count is, instead of in a message. Each one');
  console.log('  books no ingredients until its recipe is fixed:');
}
for (const [name, qty, unit, why] of recordOnly) console.log(`  ${pad(name, 32)} ${pad(counted(qty, unit), 12)} ${why}`);
if (!RECORD_ONLY) for (const [name, qty, unit, why] of skipped) console.log(`  ${pad(name, 32)} ${pad(counted(qty, unit), 12)} ${why}`);
if (alreadyThere.length) {
  console.log(`\nALREADY ON THE SHEET (${alreadyThere.length}) - left alone so a re-run cannot duplicate them`);
  for (const [name, qty, unit] of alreadyThere) console.log(`  ${pad(name, 32)} ${pad(counted(qty, unit), 12)}`);
}

// Only the items already counted on this sheet receive their share. Anything
// else is left alone on purpose: a prep line says what is inside a tub, never
// what is loose on the shelf.
const onSheet = new Set(stocktake.lines.map((l) => l.itemId).filter(Boolean));
const heldElsewhere = new Map();
for (const row of toAdd) {
  for (const c of row.explosion.components) {
    if (onSheet.has(c.itemId)) continue;
    heldElsewhere.set(c.itemId, (heldElsewhere.get(c.itemId) ?? { name: c.itemName, unit: c.unit, qty: 0 }));
    heldElsewhere.get(c.itemId).qty += c.quantity;
  }
}
if (heldElsewhere.size) {
  console.log(`\nHELD IN PREP BUT NOT COUNTED ON THIS SHEET (${heldElsewhere.size})`);
  console.log('  Their stock is left untouched on purpose. Add them to the sheet to include them.');
  for (const v of heldElsewhere.values()) console.log(`      ${pad(v.name, 34)} ${Math.round(v.qty * 1e6) / 1e6} ${v.unit}`);
}

if (!CONFIRM) {
  console.log('\nDRY RUN - nothing was written. Re-run with PREP_CONFIRM=YES to add them.');
  await prisma.$disconnect();
  process.exit(0);
}

let position = Math.max(0, ...stocktake.lines.map((l) => l.position ?? 0));
let added = 0;
for (const row of toAdd) {
  position += 1;
  await prisma.stocktakeLine.create({
    data: {
      stocktakeId: stocktake.id,
      recipeId: row.recipe.id,
      label: row.recipe.title,
      countedQty: row.qty,
      unit: row.unit,
      location: STOCKTAKE_PREP_AREA,
      position,
      stockValueCents: row.explosion.valueCents,
      notes: `Counted by hand as "${row.name}"`
    }
  });
  added += 1;
}
let recorded = 0;
for (const [name, qty, unit, why] of recordOnly) {
  position += 1;
  await prisma.stocktakeLine.create({
    data: {
      stocktakeId: stocktake.id,
      label: name,
      countedQty: qty,
      unit,
      location: STOCKTAKE_PREP_AREA,
      position,
      // No recipe and no item, so applying skips it entirely — it moves no
      // stock. The number is here to be seen and acted on, not to be booked.
      stockValueCents: null,
      notes: `Counted by hand. Books nothing yet: ${why}`
    }
  });
  recorded += 1;
}

console.log(`\nAdded ${added} prepped-item line(s) to ${stocktake.name}.`);
if (recorded) {
  console.log(`Recorded ${recorded} more as count-only lines — they move no stock, and each says why.`);
}
console.log('Check Stock -> Stocktake -> Prepped items before approving.');

await prisma.$disconnect();
JSEOF

(cd "$DEPLOY_DIR" && docker compose exec -T -w /workspace/apps/stock-api \
  -e "PREP_CONFIRM=$CONFIRM" \
  -e "STOCKTAKE_ID=${STOCKTAKE_ID:-}" \
  -e "SKIP=$SKIP_LIST" \
  -e "RECORD_ONLY=$RECORD_ONLY" \
  "$SERVICE" node "$SCRIPT_IN_CONTAINER")
