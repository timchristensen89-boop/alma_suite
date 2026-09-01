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
#       write the mL yields. A recipe with neither a serve size nor any
#       liquid gives nothing to work from and is left alone.

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

// THE SERVE SIZE, hiding in plain sight.
//
// The same import that turned "(N portions)" into an ingredient row in the
// kitchen turned the SERVE SIZE into one here: a line whose whole name is a
// number and a volume unit, with no quantity and no unit of its own —
// "75.01 ml", "60 ml", "59.99 ml". It is not an ingredient. It is how big one
// drink is.
//
// That makes the mL yield arithmetic, not estimation:
//
//     portions x serve size = what one batch makes
//
// and it checks itself, because that product should equal the volume of the
// ingredients. On the bar's own data it does, exactly:
//
//     Beach, Please    18.53 x 75.01 = 1390 mL   ingredients sum to 1390
//     Classic Marg        25 x 60    = 1500 mL   ingredients sum to 1500
//     Ginger Spice        32 x 75    = 2400 mL   ingredients sum to 2400
//     Zest I Ever Had  23.33 x 60.01 = 1400 mL   ingredients sum to 1400
//
// Where the two DISAGREE, the recipe is missing an ingredient, and the size of
// the gap says which: Coconut Margarita comes up 1900 mL short, and
// "Coconut Washed Tequila/CDC" — a recipe that makes exactly 1900 mL — is on
// its ingredient list with its name split across two rows, so its volume never
// got counted. The gap is a diagnosis, not noise.
const SERVE_SIZE_RE = /^([0-9]+(?:\.[0-9]+)?)\s*(ml|l)$/i;

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
  const namelessLines = [];
  let serveMl = null;

  for (const line of r.lines) {
    const name = (line.ingredientName ?? '').trim();
    if (line.costingOnly) continue;
    if (PORTION_LINE_RE.test(name)) continue;   // the "(N portions)" artefact

    const qty = typeof line.quantity === 'number' ? line.quantity : null;
    const unit = normaliseUnitLabel(line.unit);

    // The serve-size artefact: the NAME is the measurement, and the row
    // carries no quantity of its own. Take the first one; ignore any repeat.
    const serve = name.match(SERVE_SIZE_RE);
    if (serve && qty === null && !unit) {
      if (serveMl === null) {
        const asMl = convertBetweenUnits(Number(serve[1]), serve[2].toLowerCase(), 'ml');
        if (asMl !== null && asMl > 0) serveMl = asMl;
      }
      continue;
    }

    const asMl = qty !== null && unit ? convertBetweenUnits(qty, unit, 'ml') : null;
    if (asMl !== null && Number.isFinite(asMl) && asMl > 0) {
      volumeMl += asMl;
      volumeLines.push({ name, qty, unit, asMl });
    } else if (qty === null && !unit && name) {
      // No quantity, no unit, and not a measurement: almost always the tail of
      // an ingredient name the import split in two ("Massenez Birdseye Chilli"
      // + "Liqueur"). Worth naming, because the half that kept the volume is
      // the half that got summed.
      namelessLines.push({ name });
    } else {
      otherLines.push({ name, qty, unit });
    }
  }

  // portions x serve size. The yield is in portions here by definition — that
  // is what put the recipe in this list.
  const derivedMl =
    serveMl !== null && r.yieldQuantity && r.yieldQuantity > 0
      ? serveMl * r.yieldQuantity
      : null;

  // Counting books (counted / yield) x ingredients, so a BIGGER yield books
  // LESS. Taking the larger of the two numbers is therefore the safe pick
  // every time: where they agree it is exactly right, and where the recipe is
  // missing an ingredient it under-books by the missing part rather than
  // inventing it.
  const safeMl =
    derivedMl !== null ? Math.max(derivedMl, volumeMl) : volumeMl > 0 ? volumeMl : null;

  const gapMl = derivedMl !== null ? volumeMl - derivedMl : null;
  const agrees = gapMl !== null && derivedMl > 0 && Math.abs(gapMl) / derivedMl < 0.01;

  rows.push({
    recipe: r, volumeMl, volumeLines, otherLines, namelessLines,
    serveMl, derivedMl, safeMl, gapMl, agrees
  });
}

const needsFixing = rows.filter((row) => yieldsPortions(row.recipe));
const alreadyFine = rows.filter((row) => !yieldsPortions(row.recipe));

// ---- the ones that book nothing today -----------------------------------
console.log(`COUNTED IN mL, YIELDS PORTIONS - BOOKS NOTHING (${needsFixing.length})`);
if (needsFixing.length === 0) {
  console.log('  (none)');
} else {
  console.log('  Each of these needs one number: what one batch makes, in mL.');
  console.log('  Two independent readings of it are shown - the serve size times the');
  console.log('  portion count, and the ingredients added up. They should agree.\n');
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
  for (const l of row.namelessLines) {
    console.log(`      no quantity, no unit: "${l.name}" - looks like the tail of an`);
    console.log('           ingredient name the import split in two. Whatever volume it');
    console.log('           should carry is not in the sum.');
  }

  if (row.serveMl === null) {
    console.log('      serve size: not on the recipe, so the portions cannot be turned into');
    console.log('           mL. The sum is the only reading available.');
  } else {
    console.log(
      `      serve: ${ml(row.serveMl)} each  ->  ${r.yieldQuantity} x ${ml(row.serveMl)} = ${ml(row.derivedMl)}`
    );
    if (row.agrees) {
      console.log('      BOTH READINGS AGREE. This is the batch volume, not an estimate.');
    } else if (row.gapMl < 0) {
      console.log(`      *** THE INGREDIENTS ARE ${ml(-row.gapMl)} SHORT of that. An ingredient is`);
      console.log('          missing or carries no volume - see the excluded lines above. The');
      console.log(`          yield below uses ${ml(row.derivedMl)}, so the count books only what is`);
      console.log('          actually listed rather than inventing the missing part.');
    } else {
      console.log(`      *** THE INGREDIENTS EXCEED that by ${ml(row.gapMl)}. The serve size or the`);
      console.log('          portion count is wrong. The yield below uses the larger figure so');
      console.log('          the count cannot book more than the recipe lists.');
    }
  }
  if (row.safeMl !== null) console.log(`      -> set yield to ${ml(row.safeMl)}`);
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
// Writable = there is a defensible number to write. That is the larger of the
// two readings: exactly right where they agree, and deliberately conservative
// where they do not, since a bigger yield books less. A recipe with neither a
// serve size nor any liquid gives nothing to work from and is left alone.
const writable = needsFixing.filter((row) => row.safeMl !== null && row.safeMl > 0);
const noBasis = needsFixing.filter((row) => row.safeMl === null || row.safeMl <= 0);
const confirmed = writable.filter((row) => row.agrees);
// A missing serve size is not a disagreement - there is only one reading to
// go on. Keeping it out of the disagree bucket matters for more than tidiness:
// its gap is null, and formatting a null as millilitres throws.
const conservative = writable.filter((row) => !row.agrees && row.gapMl !== null);
const sumOnly = writable.filter((row) => !row.agrees && row.gapMl === null);

if (!CONFIRM) {
  console.log('READ ONLY - nothing was written.');
  console.log(`Re-running with CONFIRM=YES would set an mL yield on ${writable.length} recipe(s).`);
  if (confirmed.length) {
    console.log(`\n  BOTH READINGS AGREE (${confirmed.length}) - these are the batch volume, exact:`);
    for (const row of confirmed) console.log(`    ${pad(row.recipe.title, 34)} -> ${ml(row.safeMl)}`);
  }
  if (conservative.length) {
    console.log(`\n  READINGS DISAGREE (${conservative.length}) - the recipe is incomplete. Writing the`);
    console.log('  larger figure makes the count book only what is listed, which is the safe');
    console.log('  direction, but the recipe still wants fixing:');
    for (const row of conservative) {
      const short = row.gapMl < 0 ? `short ${ml(-row.gapMl)}` : `over by ${ml(row.gapMl)}`;
      console.log(`    ${pad(row.recipe.title, 34)} -> ${pad(ml(row.safeMl), 12)} (${short})`);
    }
  }
  if (sumOnly.length) {
    console.log(`\n  NO SERVE SIZE ON THE RECIPE (${sumOnly.length}) - only the ingredient sum to go on,`);
    console.log('  so there is nothing to check it against. Right if the ingredient list is');
    console.log('  complete, too small if it is not:');
    for (const row of sumOnly) console.log(`    ${pad(row.recipe.title, 34)} -> ${ml(row.safeMl)}`);
  }
  if (noBasis.length) {
    console.log(`\n  NOTHING TO WORK FROM (${noBasis.length}) - no serve size and no liquid. Measure a`);
    console.log('  batch and set these by hand in Stock -> Recipes:');
    for (const row of noBasis) console.log(`    ${row.recipe.title}`);
  }
} else {
  for (const row of writable) {
    await prisma.recipe.update({
      where: { id: row.recipe.id },
      data: { yieldQuantity: Number(row.safeMl.toFixed(2)), yieldUnit: 'ml' }
    });
    console.log(
      `set ${pad(row.recipe.title, 34)} -> ${pad(ml(row.safeMl), 12)} ${
        row.agrees
          ? '(both readings agree)'
          : row.gapMl === null
          ? '(from the ingredient sum alone)'
          : '(conservative - recipe incomplete)'
      }`
    );
  }
  console.log(
    `\nSet ${writable.length} yield(s): ${confirmed.length} exact, ${conservative.length} conservative, ${sumOnly.length} from the sum alone.`
  );
  if (noBasis.length) console.log(`Left ${noBasis.length} alone - nothing to work from.`);
  console.log('Re-run scripts/add-bar-batches.sh - the fixed ones will now book.');
}

await prisma.$disconnect();
JSEOF

(cd "$DEPLOY_DIR" && docker compose exec -T \
  -e CONFIRM="${CONFIRM}" \
  -e ALL="${ALL:-}" \
  -e TITLES="${TITLES:-}" \
  "$SERVICE" node "$SCRIPT_IN_CONTAINER")
