#!/usr/bin/env bash
set -euo pipefail

# Which prepped items can actually be counted — and what stops the rest.
#
# The first stocktake on the new app came back 100% counted, with twenty-two
# things written out by hand at the bottom because there was nowhere to put
# them: 11.707 kg of chipotle mayo, 8.884 kg of bean purée, 30 kg of ribs.
# Every one of those is stock. Counting them is now possible, but a count only
# turns back into ingredients if the recipe behind it has a batch yield and its
# lines are linked to stock items. A recipe missing either explodes into
# nothing — and that failure is SILENT: the line is counted, saved and
# approved, and books not one gram.
#
# This is the list of what to fix, before the next count rather than after it.
# It writes nothing.
#
# FIRST, AND IN THIS ORDER. `prisma migrate deploy` runs INSIDE the container,
# so it reads the migrations baked into the image — running it before the
# rebuild reads the OLD image and reports "no pending migrations" while doing
# nothing. Rebuild, then migrate:
#
#   cd /opt/alma/alma-suite && git fetch origin main && git checkout -f -B main FETCH_HEAD
#   cd /opt/alma/deploy && docker compose build stock-api && docker compose up -d stock-api
#   docker compose exec -T stock-api sh -c "cd /workspace/packages/db && npx prisma migrate deploy --schema prisma/schema.prisma"
#
# Then, on the VPS:
#
#   cd /opt/alma/alma-suite && ./scripts/prep-count-readiness.sh
#       ...the chef's twenty-two, matched against the recipe book.
#
#   cd /opt/alma/alma-suite && ALL=YES ./scripts/prep-count-readiness.sh
#       ...every active prep recipe, not just those twenty-two.

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

echo "→ API service: $SERVICE"
echo "→ Mode:        READ ONLY — nothing is written"
echo

SCRIPT_IN_CONTAINER="/workspace/apps/stock-api/.prep-readiness.mjs"

(cd "$DEPLOY_DIR" && docker compose exec -T "$SERVICE" sh -c "cat > $SCRIPT_IN_CONTAINER") <<'JSEOF'
import { prisma } from '@alma/db';
import { prepCountReadiness } from './dist/apps/stock-api/src/lib/prep-explosion.js';

// What the chef counted by hand on 31 August, verbatim, with the quantity so
// the unit each one is counted in is visible next to the recipe's yield unit.
// A mismatch there (30 kg of ribs against a recipe that yields portions) is a
// refusal, not a guess, and it belongs in this report.
const COUNTED_BY_HAND = [
  ['Mole for broccolini', '7.414 kg'],
  ['Salmon pâté', '468 g'],
  ['Cauliflower purée', '3.010 kg'],
  ['Chimichurri', '379 g'],
  ['Chipotle mayo', '11.707 kg'],
  ['Salsa macha', '2.981 kg'],
  ['Habanero salsa', '1.426 kg'],
  ['Octopus', '2.099 kg'],
  ['Ribs', '30 kg (75 portions)'],
  ['Birria', '6 kg'],
  ['Chorizo taco filling', '950 g'],
  ['Cooked chicken thigh with skin', '2.669 kg'],
  ['Sikil pak', '4.126 kg'],
  ['Polenta', '6.450 kg'],
  ['Morita salsa', '1.250 kg'],
  ['Tomatillo salsa', '670 g'],
  ['Mushroom filling', '3.809 kg'],
  ['Chocolate sauce', '2.233 kg'],
  ['Nopal taco filling', '3.748 kg'],
  ['Bean purée', '8.884 kg'],
  ['Adobo for chicken and octopus', '2.597 kg'],
  ['Tinga', '11 kg']
];

const STOPWORDS = new Set(['for', 'and', 'the', 'with', 'of', 'a']);

function tokens(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // pâté, purée
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !STOPWORDS.has(word));
}

/**
 * Matching a hand-written name to a recipe, without pretending to be sure.
 *
 * Counting shared words does not work here, because the words these names
 * share are the ones that mean least. "Habanero salsa" and "Pineapple Salsa"
 * have half their words in common and are not the same thing; the whole
 * identity is in "habanero", a word that appears in no recipe title at all.
 *
 * So each word is weighted by how rare it is across the recipe book — the
 * standard inverse-document-frequency idea. "Salsa" appears everywhere and
 * carries almost nothing; "sikil", "morita", "chorizo" appear nowhere and
 * carry everything. A match has to cover most of the WEIGHT of the name, not
 * most of its words.
 *
 * Ties break toward the title with the least left over, so "Tinga" finds
 * "Chicken Tinga" rather than "Chicken Tinga Empanada".
 *
 * Nothing here is ever acted on. It prints a candidate for a person to
 * confirm, because "Mole for broccolini" against "Mole Verde" and "Chicken
 * with Mole" is a question only the kitchen can answer.
 */
function buildMatcher(recipes) {
  const documentFrequency = new Map();
  for (const recipe of recipes) {
    for (const word of new Set(tokens(recipe.title))) {
      documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
    }
  }
  const total = recipes.length;
  const weight = (word) => Math.log((total + 1) / ((documentFrequency.get(word) ?? 0) + 1));

  return function match(name) {
    const wanted = [...new Set(tokens(name))];
    const wantedWeight = wanted.reduce((sum, word) => sum + weight(word), 0);
    if (wantedWeight <= 0) return [];

    const scored = [];
    for (const recipe of recipes) {
      const have = new Set(tokens(recipe.title));
      const matched = wanted.filter((word) => have.has(word));
      if (matched.length === 0) continue;
      const matchedWeight = matched.reduce((sum, word) => sum + weight(word), 0);
      const leftOver = [...have]
        .filter((word) => !matched.includes(word))
        .reduce((sum, word) => sum + weight(word), 0);
      scored.push({
        recipe,
        score: matchedWeight / wantedWeight,
        leftOver,
        exact: matched.length === wanted.length && have.size === wanted.length
      });
    }
    return scored.sort((a, b) => (b.score - a.score) || (a.leftOver - b.leftOver));
  };
}

// How much of a name's weight a candidate must carry to be offered as the
// match rather than merely as "nearest". Below this the report says NO RECIPE
// and still names what it nearly hit, which is the useful half of a near miss.
const MATCH_THRESHOLD = 0.6;

function pad(value, width) {
  const text = String(value ?? '');
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

const rows = await prisma.recipe.findMany({
  where: { status: 'ACTIVE', isPrepRecipe: true },
  select: {
    id: true,
    title: true,
    yieldQuantity: true,
    yieldUnit: true,
    lines: {
      select: { ingredientName: true, quantity: true, unit: true, itemId: true, subRecipeId: true, costingOnly: true },
      orderBy: { position: 'asc' }
    }
  },
  orderBy: { title: 'asc' }
});

// Sub-recipes may sit below an active prep recipe without being one
// themselves; readiness needs them or a perfectly good recipe reads as broken.
const subIds = [
  ...new Set(rows.flatMap((row) => row.lines.map((line) => line.subRecipeId).filter(Boolean)))
].filter((id) => !rows.some((row) => row.id === id));
const subs = subIds.length
  ? await prisma.recipe.findMany({
      where: { id: { in: subIds } },
      select: {
        id: true,
        title: true,
        yieldQuantity: true,
        yieldUnit: true,
        lines: {
          select: { ingredientName: true, quantity: true, unit: true, itemId: true, subRecipeId: true, costingOnly: true },
          orderBy: { position: 'asc' }
        }
      }
    })
  : [];

const specs = new Map([...rows, ...subs].map((row) => [row.id, row]));
const itemIds = [
  ...new Set([...specs.values()].flatMap((spec) => spec.lines.map((line) => line.itemId).filter(Boolean)))
];
const items = new Map(
  (
    await prisma.stockItem.findMany({
      where: { id: { in: itemIds } },
      select: {
        id: true,
        name: true,
        unit: true,
        countUnit: true,
        conversionFactor: true,
        measurePerCountUnit: true,
        measureUnit: true,
        avgCostCents: true
      }
    })
  ).map((item) => [item.id, item])
);

const readinessById = new Map(
  rows.map((row) => [row.id, prepCountReadiness(specs.get(row.id), specs, items)])
);

if (process.env.ALL === 'YES') {
  const ready = rows.filter((row) => readinessById.get(row.id).countable);
  const blocked = rows.filter((row) => !readinessById.get(row.id).countable);
  console.log(`EVERY ACTIVE PREP RECIPE — ${ready.length} countable, ${blocked.length} not\n`);
  console.log(`READY TO COUNT (${ready.length})`);
  for (const row of ready) {
    console.log(`  ${pad(row.title, 36)} makes ${row.yieldQuantity} ${row.yieldUnit ?? ''}`);
  }
  console.log(`\nNOT COUNTABLE YET (${blocked.length})`);
  for (const row of blocked) {
    console.log(`  ${row.title}`);
    for (const problem of readinessById.get(row.id).problems) console.log(`      ${problem}`);
  }

  // The import artifact, called out on its own because it is one fix repeated
  // rather than N separate ones: a yield note that became an ingredient row.
  const junk = rows.filter((row) =>
    row.lines.some((line) => !line.itemId && !line.subRecipeId && /^\(\s*[\d.]+\s*portions?\s*\)$/i.test(line.ingredientName.trim()))
  );
  if (junk.length) {
    console.log(`\nLIKELY IMPORT JUNK — an ingredient line named "(N portions)" (${junk.length} recipes)`);
    console.log('  A yield note that became an ingredient row. It books nothing and is safe to');
    console.log('  delete; until then every one of these reports an unlinked ingredient.');
    for (const row of junk) console.log(`      ${row.title}`);
  }
  await prisma.$disconnect();
  process.exit(0);
}

console.log(`THE ${COUNTED_BY_HAND.length} PREPPED ITEMS COUNTED BY HAND, AGAINST THE RECIPE BOOK\n`);

const match = buildMatcher(rows);
const noRecipe = [];
const needsFixing = [];
const ready = [];

for (const [name, counted] of COUNTED_BY_HAND) {
  const ranked = match(name);
  const best = ranked[0];
  if (!best || best.score < MATCH_THRESHOLD) {
    noRecipe.push([name, counted, ranked.slice(0, 2).map((row) => row.recipe.title)]);
    continue;
  }
  // Anything close behind is a real ambiguity ("Bean purée" against both
  // Butter Bean Puree and Refried Bean Puree) and belongs in the report.
  const alternatives = ranked
    .slice(1)
    .filter((row) => best.score - row.score < 0.15)
    .slice(0, 2)
    .map((row) => row.recipe.title);
  const readiness = readinessById.get(best.recipe.id);
  const entry = [name, counted, best.recipe, readiness, best.exact, alternatives];
  if (readiness.countable) ready.push(entry);
  else needsFixing.push(entry);
}

console.log(`READY TO COUNT (${ready.length})`);
if (ready.length === 0) console.log('  (none yet)');
else {
  console.log('  "Makes" came from scripts/estimate-recipe-yields.ts, which set every yield to the');
  console.log('  total weight of the ingredients. That is mass-balanced — counting 6 kg of a prep');
  console.log('  books about 6 kg of ingredients back, whatever the batch size is written at — and');
  console.log('  where the kitchen really does cook liquid off, the yield is too HIGH, so the count');
  console.log('  books too LITTLE. That is the safe direction. Nudge a yield DOWN only when you');
  console.log('  know the real loss; nudging it down too far books stock that is not there.');
  console.log('');
}
for (const [name, counted, recipe, readiness, exact, alternatives] of ready) {
  console.log(
    `  ${pad(name, 32)} ${pad(counted, 20)} → ${pad(recipe.title, 30)} makes ${recipe.yieldQuantity} ${recipe.yieldUnit ?? ''}${exact ? '' : '   (check this is the right recipe)'}`
  );
  if (alternatives.length) console.log(`  ${' '.repeat(32)} or maybe: ${alternatives.join(', ')}`);
  // Countable, but not complete. Worth counting today and worth fixing.
  for (const warning of readiness.warnings) console.log(`  ${' '.repeat(32)} ${warning}`);
}

console.log(`\nHAS A RECIPE, BUT A COUNT OF IT WOULD BOOK NOTHING (${needsFixing.length})`);
if (needsFixing.length === 0) console.log('  (none)');
for (const [name, counted, recipe, readiness, exact, alternatives] of needsFixing) {
  console.log(`  ${name}  —  counted ${counted}  →  ${recipe.title}${exact ? '' : '   (check this is the right recipe)'}`);
  if (alternatives.length) console.log(`      or maybe: ${alternatives.join(', ')}`);
  for (const problem of readiness.problems) console.log(`      ${problem}`);
  for (const warning of readiness.warnings) console.log(`      also: ${warning}`);
}

console.log(`\nNO PREP RECIPE AT ALL (${noRecipe.length})`);
if (noRecipe.length === 0) console.log('  (none)');
for (const [name, counted, nearest] of noRecipe) {
  console.log(`  ${pad(name, 32)} ${pad(counted, 20)}${nearest.length ? `   nearest titles: ${nearest.join(', ')}` : ''}`);
}

const partial = ready.filter(([, , , readiness]) => readiness.warnings.length).length;
console.log(
  `\nSummary: ${ready.length} countable now (${partial} of them will book less than everything), ${needsFixing.length} would book nothing, ${noRecipe.length} need a recipe.`
);
console.log('Nothing was written. Fix the recipes in Stock → Recipes, then re-run this.');

await prisma.$disconnect();
JSEOF

(cd "$DEPLOY_DIR" && docker compose exec -T -w /workspace/apps/stock-api "$SERVICE" node "$SCRIPT_IN_CONTAINER")
