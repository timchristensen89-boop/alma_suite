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
# It adds a line ONLY where the recipe can actually be exploded AND the weight
# the chef wrote converts to that recipe's yield unit. Anything else is listed
# with the reason and left alone, because a prep line that books nothing looks
# exactly like one that worked.

DEPLOY_DIR="${DEPLOY_DIR:-/opt/alma/deploy}"
CONFIRM="${PREP_CONFIRM:-NO}"

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
      select: { id: true, name: true, venue: true, status: true, appliedAt: true, lines: { select: { id: true, position: true, recipeId: true, itemId: true } } }
    })
  : await prisma.stocktake.findFirst({
      where: { status: 'SUBMITTED', name: { contains: 'Kitchen' } },
      orderBy: { countedAt: 'desc' },
      select: { id: true, name: true, venue: true, status: true, appliedAt: true, lines: { select: { id: true, position: true, recipeId: true, itemId: true } } }
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
  const ranked = match(name);
  const best = ranked[0];
  if (!best || best.score < MATCH_THRESHOLD) {
    skipped.push([name, `${qty} ${unit}`, 'no prep recipe matches this name']);
    continue;
  }
  const recipe = specs.get(best.recipe.id);
  if (already.has(recipe.id)) {
    skipped.push([name, `${qty} ${unit}`, `already on this sheet as "${recipe.title}"`]);
    continue;
  }
  const claimedBy = claimed.get(recipe.id);
  if (claimedBy) {
    skipped.push([
      name,
      `${qty} ${unit}`,
      `also matched "${recipe.title}", already being added for "${claimedBy}" — adding both would book its ingredients twice`
    ]);
    continue;
  }
  const readiness = prepCountReadiness(recipe, specs, items);
  if (!readiness.countable) {
    skipped.push([name, `${qty} ${unit}`, `"${recipe.title}": ${readiness.problems.join(' ')}`]);
    continue;
  }
  // The decisive check, and the reason this is not just "add 22 lines": the
  // weight has to convert to the recipe's yield unit. A recipe that yields
  // portions cannot be counted off a scale, and a line that cannot convert
  // books nothing while looking exactly like one that worked.
  const { batches, warning } = batchesForCount(qty, unit, recipe);
  if (batches === null) {
    skipped.push([name, `${qty} ${unit}`, warning ?? 'the weight does not convert to this recipe’s yield unit']);
    continue;
  }
  const explosion = explodePrepCount({ countedQty: qty, countedUnit: unit, recipe, recipesById: specs, itemsById: items });
  claimed.set(recipe.id, name);
  toAdd.push({ name, qty, unit, recipe, explosion, verify: !(best.score >= 0.999 && best.leftOver === 0) });
}

const pad = (v, w) => String(v ?? '').padEnd(w);

console.log(`WILL ADD (${toAdd.length})`);
for (const row of toAdd) {
  console.log(
    `  ${pad(row.name, 32)} ${pad(row.qty + ' ' + row.unit, 12)} -> ${pad(row.recipe.title, 28)} ${row.explosion.components.length} ingredient(s)${row.verify ? '   (check this is the right recipe)' : ''}`
  );
  for (const c of row.explosion.components.slice(0, 4)) {
    console.log(`        ${pad(c.itemName, 34)} ${c.quantity} ${c.unit}`);
  }
  if (row.explosion.components.length > 4) console.log(`        ... and ${row.explosion.components.length - 4} more`);
}

console.log(`\nWILL NOT ADD (${skipped.length})`);
for (const [name, counted, why] of skipped) console.log(`  ${pad(name, 32)} ${pad(counted, 12)} ${why}`);

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
console.log(`\nAdded ${added} prepped-item line(s) to ${stocktake.name}.`);
console.log('Check Stock -> Stocktake -> Prepped items before approving.');

await prisma.$disconnect();
JSEOF

(cd "$DEPLOY_DIR" && docker compose exec -T -w /workspace/apps/stock-api -e "PREP_CONFIRM=$CONFIRM" -e "STOCKTAKE_ID=${STOCKTAKE_ID:-}" "$SERVICE" node "$SCRIPT_IN_CONTAINER")
