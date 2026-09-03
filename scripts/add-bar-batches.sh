#!/usr/bin/env bash
set -euo pipefail

# Dirk's batched cocktails, onto the Bar count they were left off.
#
# The bar hit the same wall the kitchen did. Dirk's message was:
#
#     "There's no section for pre arched cocktail"
#     "batched**"
#
# ...so he printed the recipe list, wrote millilitres down the margin in pen,
# and photographed it. That paper is the only record that the bar is holding
# several litres of made cocktail, and none of it is on the count.
#
# This puts those numbers on the sheet. It is the bar twin of
# add-prep-lines.sh, with three deliberate differences:
#
#  1. MATCHING IS BY EXACT TITLE, not by fuzzy name. Dirk wrote his numbers
#     against the app's own printed recipe list, so the names already ARE the
#     recipe titles — there is nothing to guess. Fuzzy matching is what nearly
#     booked the octopus twice on the kitchen count; with an exact list there
#     is no reason to invite it. A name that does not match exactly is
#     reported, not guessed at.
#
#  2. IT CHECKS THE UNIT WILL CONVERT, loudly, before anything is written.
#     A cocktail batch recipe is normally written "makes 40 serves". Dirk has
#     counted millilitres. Millilitres do not convert to serves — there is no
#     arithmetic from one to the other without knowing how big a serve is — so
#     against a portions yield every one of these lines books NOTHING, and
#     does it silently. That is the single most likely outcome here, which is
#     why the dry run separates "will book" from "books nothing" rather than
#     burying it in a warning.
#
#  3. A SHARED TITLE IS RESOLVED BY THE COUNT'S VENUE, and only by that.
#     The catalogue holds one copy of each recipe per venue, so "Ginger Spice
#     Batch" existing twice is the normal shape, not a duplicate to merge. A
#     count belongs to one venue, so the row for that venue is the right one.
#     Anything that does not narrow to exactly one row is still refused.
#
# Dry run by default. Nothing is written without PREP_CONFIRM=YES.
#
#   cd /opt/alma/alma-suite && ./scripts/add-bar-batches.sh
#       ...shows the match, the yield, and what each line would book.
#
#   STOCKTAKE_ID=<id> ./scripts/add-bar-batches.sh
#       ...target a specific count. Without it, the most recent SUBMITTED or
#       IN_PROGRESS count whose name or template mentions Bar.
#
#   SKIP="Razzle Bazzle Batch" ./scripts/add-bar-batches.sh
#       ...leave one off, by recipe title.
#
#   PREP_CONFIRM=YES ./scripts/add-bar-batches.sh
#       ...write them.
#
# THE NUMBERS BELOW WERE READ OFF A PHOTOGRAPH OF HANDWRITING.
# They are a starting point, not a source of truth. The dry run prints every
# one back so it can be checked against the paper before anything is written —
# do that. A misread digit here becomes real stock, which is exactly how four
# lines of millilitres-recorded-as-bottles became $1.5M of gin that was never
# in the building.

DEPLOY_DIR="${DEPLOY_DIR:-/opt/alma/deploy}"
CONFIRM="${PREP_CONFIRM:-NO}"
SKIP_LIST="${SKIP:-}"

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

SCRIPT_IN_CONTAINER="/workspace/apps/stock-api/.add-bar-batches.mjs"

(cd "$DEPLOY_DIR" && docker compose exec -T "$SERVICE" sh -c "cat > $SCRIPT_IN_CONTAINER") <<'JSEOF'
import { prisma } from '@alma/db';
import { STOCKTAKE_PREP_AREA } from '@alma/shared';
import {
  batchesForCount,
  explodePrepCount
} from './dist/apps/stock-api/src/lib/prep-explosion.js';

const CONFIRM = process.env.PREP_CONFIRM === 'YES';
const SKIP = new Set(
  (process.env.SKIP ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean)
);

// Dirk's sheet: recipe title exactly as the app printed it, then the total he
// wrote in the right-hand column, in millilitres.
//
// TRANSCRIBED FROM A PHOTO. Check every line against the paper before writing.
// A null quantity means "he did not give one" — reported, never written.
const COUNTED = [
  ['Beach, Please Batch',              1775, 'ml'],
  ['Classic Margarita Batch',          8875, 'ml'],
  ['Coconut Margarita Batch',          5350, 'ml'],
  ['Espresso Martini Batch',           1700, 'ml'],
  ['Ginger Spice Batch',               1600, 'ml'],
  ['Oaxacan Negroni Batch',             600, 'ml'],
  ['Pink Skies Batch',                 1075, 'ml'],
  ['Pistachio and vanilla bean flan',  null, 'each'],
  ['Paloma Margarita Batch',           1825, 'ml'],
  ['Razzle Bazzle Batch',              1500, 'ml'],
  ['Sensible Marg Batch',              7650, 'ml'],
  ['Spiced Tequila & Triple Sec',      3100, 'ml'],
  ['Strawberry Habanero Sour Batch',   null, 'ml']
];

const money = (cents) =>
  cents === null || cents === undefined
    ? '-'
    : `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function pad(v, w) { const t = String(v ?? ''); return t.length >= w ? t : t + ' '.repeat(w - t.length); }
function padLeft(v, w) { const t = String(v ?? ''); return t.length >= w ? t : ' '.repeat(w - t.length) + t; }
const norm = (v) => (v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
// Word set for the "did you mean" suggestions only. Deliberately crude: it
// never decides anything, it just gives a person three titles to look at.
function tokens(value) {
  return norm(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 2 && !['the', 'and', 'for', 'with', 'batch'].includes(t));
}

// ---- the count to write onto -------------------------------------------
let stocktake;
if (process.env.STOCKTAKE_ID) {
  stocktake = await prisma.stocktake.findUnique({
    where: { id: process.env.STOCKTAKE_ID },
    include: { lines: { select: { id: true, label: true, recipeId: true } } }
  });
  if (!stocktake) {
    console.log(`No stocktake with id ${process.env.STOCKTAKE_ID}.`);
    await prisma.$disconnect();
    process.exit(1);
  }
} else {
  const candidates = await prisma.stocktake.findMany({
    where: { status: { in: ['SUBMITTED', 'IN_PROGRESS'] } },
    orderBy: { countedAt: 'desc' },
    include: { lines: { select: { id: true, label: true, recipeId: true } } }
  });
  if (candidates.length === 0) {
    console.log('No open stocktakes at all.');
    await prisma.$disconnect();
    process.exit(1);
  }
  const bars = candidates.filter((s) =>
    /bar|foh|front/i.test(`${s.name ?? ''} ${s.template ?? ''}`)
  );
  if (bars.length === 0) {
    console.log('Could not find an open Bar count. Pass STOCKTAKE_ID=<id>. Open counts:');
    for (const s of candidates) {
      console.log(`  ${s.id}  ${pad(s.status, 12)} ${s.name} (${s.venue ?? 'no venue'})`);
    }
    await prisma.$disconnect();
    process.exit(1);
  }
  // More than one open Bar count means two venues, or a stale one still
  // sitting in the queue. Picking the most recent silently is how a bar's
  // numbers land on another venue's sheet — and the first run of this script
  // did exactly that, offering Alma Avalon's January count for St Alma's
  // batches. A write needs to be aimed, not guessed.
  if (bars.length > 1) {
    console.log(`${bars.length} open Bar counts. Pass STOCKTAKE_ID=<id> to say which one:\n`);
    for (const s of bars) {
      const when = s.countedAt ? new Date(s.countedAt).toISOString().slice(0, 10) : 'no date';
      console.log(`  ${s.id}  ${pad(s.status, 12)} ${pad(s.venue ?? 'no venue', 14)} ${when}  ${s.name}`);
    }
    await prisma.$disconnect();
    process.exit(1);
  }
  stocktake = bars[0];
}

console.log(`Stocktake: ${stocktake.name}`);
console.log(`  ${stocktake.venue ?? 'no venue'} · ${stocktake.status} · ${stocktake.lines.length} lines\n`);

// ---- the recipes --------------------------------------------------------
const recipeRows = await prisma.recipe.findMany({
  where: { status: 'ACTIVE', isPrepRecipe: true },
  select: {
    id: true, title: true, venue: true, yieldQuantity: true, yieldUnit: true,
    lines: {
      select: { ingredientName: true, quantity: true, unit: true, itemId: true, subRecipeId: true, costingOnly: true },
      orderBy: { position: 'asc' }
    }
  }
});
// Titles are not unique. The recipe book holds two "Beach, Please Batch" rows
// and two "Ginger Spice Batch" rows, among others. Building a Map here keeps
// whichever row the database happened to return LAST, so an exact-title match
// silently picks one of two different recipes with different yields. That is
// the same class of quiet wrong answer the fuzzy matching was removed to
// avoid, and it is worse, because the title matched perfectly and nothing
// looks suspicious.
//
// So: collect every row per title, and resolve the pick deliberately below.
const byTitle = new Map();
for (const r of recipeRows) {
  const key = norm(r.title);
  if (!byTitle.has(key)) byTitle.set(key, []);
  byTitle.get(key).push(r);
}
const specs = new Map(recipeRows.map((r) => [r.id, r]));
const itemIds = [...new Set(recipeRows.flatMap((r) => r.lines.map((l) => l.itemId).filter(Boolean)))];
const items = new Map(
  (await prisma.stockItem.findMany({
    where: { id: { in: itemIds } },
    select: {
      id: true, name: true, unit: true, countUnit: true, conversionFactor: true,
      measurePerCountUnit: true, measureUnit: true, avgCostCents: true
    }
  })).map((i) => [i.id, i])
);

const onSheet = new Set(stocktake.lines.map((l) => l.recipeId).filter(Boolean));

const willBook = [];
const booksNothing = [];
const noQuantity = [];
const noMatch = [];
const ambiguous = [];
const already = [];

for (const [title, qty, unit] of COUNTED) {
  if (SKIP.has(norm(title))) continue;
  const matches = byTitle.get(norm(title)) ?? [];
  if (matches.length === 0) { noMatch.push({ title, qty, unit }); continue; }

  // Two rows under one title is usually not a duplicate waiting to be merged.
  // The catalogue is duplicated per venue on purpose — Recipe.venue, and the
  // canonicalId twin link the schema documents — so "Beach, Please Batch"
  // exists once for St Alma and once for Alma Avalon, with different
  // quantities because the two bars batch different sizes. Merging them would
  // be the wrong repair.
  //
  // A count belongs to exactly one venue, and each venue's recipe is the one
  // whose ingredients point at that venue's stock items, so narrowing to the
  // count's own venue is not a coin toss — it is the only reading that books
  // against the right stock. Anything that does not narrow to exactly one row
  // is still refused.
  let recipe;
  let pickedFrom = 0;
  if (matches.length === 1) {
    recipe = matches[0];
  } else {
    const here = matches.filter((m) => m.venue && norm(m.venue) === norm(stocktake.venue));
    if (here.length !== 1) { ambiguous.push({ title, qty, unit, matches }); continue; }
    recipe = here[0];
    pickedFrom = matches.length;
  }
  if (onSheet.has(recipe.id)) { already.push({ title, recipe }); continue; }
  if (qty === null || qty === undefined) { noQuantity.push({ title, recipe, unit }); continue; }

  // Does the counted unit reach this recipe's yield unit at all? This is the
  // whole question for the bar: mL against a "makes 40 portions" yield gets
  // refused here, and the line would book nothing.
  const { batches, warning } = batchesForCount(qty, unit, recipe);
  if (batches === null) {
    booksNothing.push({ title, qty, unit, recipe, reason: warning, pickedFrom });
    continue;
  }
  const explosion = explodePrepCount({ countedQty: qty, countedUnit: unit, recipe, recipesById: specs, itemsById: items });
  willBook.push({ title, qty, unit, recipe, explosion, pickedFrom });
}

console.log(`WILL BOOK (${willBook.length})`);
if (!willBook.length) console.log('  (none)');
for (const r of willBook) {
  console.log(
    `  ${pad(r.title, 34)} ${padLeft(r.qty, 7)} ${pad(r.unit, 4)} -> ${pad(r.recipe.title, 30)}` +
    ` makes ${r.recipe.yieldQuantity} ${r.recipe.yieldUnit ?? ''}  books ${money(r.explosion.valueCents)}` +
    ` across ${r.explosion.components.length} item(s)`
  );
  if (r.pickedFrom) {
    console.log(
      `      ${r.pickedFrom} recipes carry this title, one per venue;` +
      ` took the ${r.recipe.venue} one to match the count`
    );
  }
}

console.log(`\nBOOKS NOTHING - THE UNIT WILL NOT CONVERT (${booksNothing.length})`);
if (!booksNothing.length) console.log('  (none)');
for (const r of booksNothing) {
  console.log(`  ${pad(r.title, 34)} ${padLeft(r.qty, 7)} ${r.unit}`);
  console.log(`      makes ${r.recipe.yieldQuantity} ${r.recipe.yieldUnit ?? '(no yield unit)'} - ${r.reason ?? 'no yield set'}`);
  if (r.pickedFrom) {
    console.log(`      (${r.pickedFrom} recipes carry this title; this is the ${r.recipe.venue} one)`);
  }
}
if (booksNothing.length) {
  console.log('\n  These are NOT written. Counting them would look like it worked and book');
  console.log('  nothing. Give each recipe a yield in mL or L - the bar measures volume -');
  console.log('  then re-run and they will book.');
}

if (noQuantity.length) {
  console.log(`\nNO QUANTITY ON THE SHEET (${noQuantity.length}) - not written`);
  for (const r of noQuantity) console.log(`  ${pad(r.title, 34)} counted in ${r.unit}, no number given`);
}
if (ambiguous.length) {
  console.log(`\nCANNOT TELL WHICH RECIPE (${ambiguous.length}) - not written`);
  console.log('  Several recipes share the title. That on its own is normal - the');
  console.log('  catalogue holds one copy per venue - and a title with exactly one row');
  console.log(`  for ${stocktake.venue ?? 'this count'} is taken automatically. These did not narrow that far:`);
  console.log('  either none of them carries the venue, or more than one does. Picking one');
  console.log('  would book a number nobody chose, and possibly against the other venue\'s');
  console.log('  stock. Set the venue on the right row in Stock -> Recipes, then re-run.');
  for (const r of ambiguous) {
    console.log(`  ${pad(r.title, 34)} ${padLeft(r.qty ?? '-', 7)} ${r.unit}`);
    for (const m of r.matches) {
      const y = m.yieldQuantity ? `makes ${m.yieldQuantity} ${m.yieldUnit ?? ''}`.trim() : 'no yield set';
      console.log(`      ${pad(m.id, 28)} ${pad(m.venue ?? 'NO VENUE', 14)} ${y}`);
    }
  }
}
if (noMatch.length) {
  console.log(`\nNO RECIPE WITH THAT EXACT TITLE (${noMatch.length}) - not written`);
  for (const r of noMatch) {
    console.log(`  ${pad(r.title, 34)} ${padLeft(r.qty ?? '-', 7)} ${r.unit}`);
    // Suggestions only. They are printed for a person to read and are never
    // selected automatically: the whole reason this script matches on exact
    // titles is that a near-miss books the wrong ingredients. Saying "did you
    // mean" costs nothing; acting on it is what nearly double-booked the
    // octopus on the kitchen count.
    const want = new Set(tokens(r.title));
    const scored = recipeRows
      .map((row) => {
        const have = new Set(tokens(row.title));
        const shared = [...want].filter((t) => have.has(t)).length;
        return { title: row.title, score: shared / Math.max(want.size, have.size, 1) };
      })
      .filter((c) => c.score > 0.25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (scored.length) {
      console.log(`      did you mean: ${scored.map((c) => c.title).join('  |  ')}`);
    } else {
      console.log('      nothing similar in the recipe book - it may need creating');
    }
  }
  console.log('  Suggestions are printed to read, never acted on. Correct the title in the');
  console.log('  COUNTED list at the top of this script, or create the recipe, then re-run.');
}
if (already.length) {
  console.log(`\nALREADY ON THIS SHEET (${already.length}) - left alone so a re-run cannot duplicate them`);
  for (const r of already) console.log(`  ${r.title}`);
}

if (!CONFIRM) {
  console.log('\nDRY RUN - nothing was written. Check every number above against the paper,');
  console.log('then re-run with PREP_CONFIRM=YES to add them.');
  await prisma.$disconnect();
  process.exit(0);
}

if (!willBook.length) {
  console.log('\nNothing to write.');
  await prisma.$disconnect();
  process.exit(0);
}

const maxPosition = await prisma.stocktakeLine.aggregate({
  where: { stocktakeId: stocktake.id },
  _max: { position: true }
});
let position = (maxPosition._max.position ?? 0) + 1;

for (const r of willBook) {
  await prisma.stocktakeLine.create({
    data: {
      stocktakeId: stocktake.id,
      recipeId: r.recipe.id,
      label: r.recipe.title,
      countedQty: r.qty,
      unit: r.unit,
      location: STOCKTAKE_PREP_AREA,
      stockValueCents: r.explosion.valueCents ?? null,
      position: position++
    }
  });
}

console.log(`\nAdded ${willBook.length} batched-cocktail line(s) to ${stocktake.name}.`);
console.log('Check Stock -> Stocktake -> Prepped items before approving.');
await prisma.$disconnect();
JSEOF

(cd "$DEPLOY_DIR" && docker compose exec -T -w /workspace/apps/stock-api \
  -e "PREP_CONFIRM=$CONFIRM" \
  -e "STOCKTAKE_ID=${STOCKTAKE_ID:-}" \
  -e "SKIP=$SKIP_LIST" \
  "$SERVICE" node "$SCRIPT_IN_CONTAINER")
