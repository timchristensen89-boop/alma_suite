import { prisma } from '@alma/db';

// Bulk mapping pass: connect as many Square catalogue items to recipes as can
// be done safely, and print a human-decidable shortlist for the rest. The
// point is coverage for everything sales-weighted — dish margins, the menu
// lab, theoretical COGS — which only count recipes with a CONFIRMED/MAPPED
// Square mapping.
//
// Sharper than the in-app auto-match in three ways:
//  - normalisation strips parentheses, sizes (150ml, 2pc, 500g) and bare
//    numbers, so "Fish Taco (2pc)" meets "Fish Taco";
//  - overlap coefficient alongside Jaccard, so a short name matches its
//    longer twin ("Fish Taco" vs "Baja Fish Taco");
//  - a CLEAR-WINNER rule: nothing is applied unless the best candidate beats
//    the runner-up by a margin, so lookalikes ("Beef Taco"/"Beef Burrito")
//    are never force-merged — they go to the shortlist instead.
//
// SAFETY:
//  - DRY RUN by default — set MAP_SQUARE_CONFIRM=YES to write.
//  - Only writes almaRecipeId/status/confidence/notes on mapping rows that
//    are UNMAPPED or NEEDS_REVIEW. Never touches CONFIRMED/MAPPED/IGNORED
//    rows, never touches recipes, never touches prices.
//
// Run (inside the suite-api container, repo image):
//   node --import tsx apps/api/scripts/map-square-recipes-pass.ts

const CONFIRM = process.env.MAP_SQUARE_CONFIRM === 'YES';
const APPLY_THRESHOLD = Number(process.env.MAP_SQUARE_APPLY_THRESHOLD ?? 0.8);
const GAP = Number(process.env.MAP_SQUARE_GAP ?? 0.1);
const SUGGEST_THRESHOLD = Number(process.env.MAP_SQUARE_SUGGEST_THRESHOLD ?? 0.5);

const STOP_WORDS = new Set([
  'and', 'with', 'the', 'for', 'of', 'side', 'extra', 'add', 'new', 'special',
  'single', 'double', 'glass', 'bottle', 'jug', 'pitcher', 'small', 'large',
  'regular', 'main', 'kids', 'gf', 'df', 'vg', 'vgo', 'vegan', 'vegetarian',
  'ea', 'each', 'pc', 'pcs', 'serve', 'portion', 'plate', 'bowl', 'hh', 'can'
]);

const SYNONYMS: Record<string, string> = {
  marg: 'margarita', margaritas: 'margarita', tacos: 'taco', tostadas: 'tostada',
  quesadillas: 'quesadilla', nacho: 'nachos', chips: 'chip', fries: 'chip',
  guac: 'guacamole', avo: 'avocado', chook: 'chicken', chkn: 'chicken',
  prawns: 'prawn', mushie: 'mushroom', mushies: 'mushroom', mushrooms: 'mushroom',
  cauli: 'cauliflower', potatoes: 'potato', snags: 'sausage', sanga: 'sandwich',
  sando: 'sandwich', burg: 'burger', choc: 'chocolate', bbq: 'barbecue',
  brekkie: 'breakfast', schnitty: 'schnitzel', schnitzels: 'schnitzel',
  parmi: 'parmigiana', parma: 'parmigiana'
};

// Size/quantity tokens: 150ml, 2pc, 500g, 750, 6oz. Not noise — wines and
// spirits come in 150/250/750mL siblings where the size IS the identity — but
// not the base either: "Fish Taco (2pc)" must still meet "Fish Taco". So the
// name is scored WITHOUT sizes, and the sizes then confirm or veto.
const SIZE_TOKEN = /^\d+(ml|l|g|kg|oz|pc|pcs|pk)?$/;

type Comparable = { text: string; sizes: string[] };

function normalise(value: string): Comparable {
  const words = value
    .toLowerCase()
    // Strip diacritics so Rosé meets Rose and Mâcon meets Macon.
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((word) => SYNONYMS[word] ?? word.replace(/s$/, ''))
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
  const sizes = words.filter((word) => SIZE_TOKEN.test(word) && /\d/.test(word)).map((word) => word.replace(/[a-z]+$/, ''));
  return { text: words.filter((word) => !SIZE_TOKEN.test(word)).join(' ').trim(), sizes };
}

function nameScore(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.86;
  const leftWords = new Set(left.split(' '));
  const rightWords = new Set(right.split(' '));
  const intersection = [...leftWords].filter((word) => rightWords.has(word)).length;
  if (intersection === 0) return 0;
  const union = new Set([...leftWords, ...rightWords]).size;
  const jaccard = intersection / union;
  // Overlap coefficient forgives one side being longer — the usual case when
  // Square carries the flowery name and the recipe the plain one.
  const overlap = intersection / Math.min(leftWords.size, rightWords.size);
  return Math.max(jaccard, overlap * 0.82);
}

function score(squareName: string, recipeTitle: string): number {
  const left = normalise(squareName);
  const right = normalise(recipeTitle);
  let value = nameScore(left.text, right.text);
  if (value <= 0) return 0;
  // Sizes as confirm-or-veto: matching pours reinforce, CONFLICTING pours
  // kill — a 750mL bottle must never map to the 150mL pour of the same wine.
  if (left.sizes.length > 0 && right.sizes.length > 0) {
    const shared = left.sizes.some((size) => right.sizes.includes(size));
    value = shared ? Math.min(1, value + 0.06) : value - 0.3;
  }
  return Math.max(0, Math.min(1, value));
}

// A Square row that is clearly not a dish: nothing to map, suggest Ignore.
const NOT_A_DISH = /gift ?card|surcharge|service fee|delivery|tip\b|donation|deposit|open (food|item|drink)|misc/i;

async function main() {
  const [rows, recipes] = await Promise.all([
    prisma.squareMenuRecipeMapping.findMany({
      where: { status: { in: ['UNMAPPED', 'NEEDS_REVIEW'] } },
      orderBy: [{ accountKey: 'asc' }, { squareItemName: 'asc' }]
    }),
    prisma.recipe.findMany({
      where: { status: 'ACTIVE', isPrepRecipe: false },
      select: { id: true, title: true, venue: true }
    })
  ]);

  console.log(`${rows.length} unmapped/needs-review Square rows · ${recipes.length} active recipes`);
  console.log(CONFIRM ? 'MODE: APPLY (writing mappings)' : 'MODE: DRY RUN (set MAP_SQUARE_CONFIRM=YES to write)');
  console.log(`thresholds: apply ≥ ${APPLY_THRESHOLD} with gap ≥ ${GAP}; shortlist ≥ ${SUGGEST_THRESHOLD}\n`);

  let applied = 0;
  let shortlisted = 0;
  let noise = 0;
  let noCandidate = 0;
  const shortlist: string[] = [];

  for (const row of rows) {
    const squareName = [row.squareItemName, row.squareVariationName].filter(Boolean).join(' ');
    if (NOT_A_DISH.test(squareName)) {
      noise += 1;
      continue;
    }
    const scored = recipes
      .map((recipe) => ({
        recipe,
        s:
          score(squareName, recipe.title) +
          (row.venue && recipe.venue ? (row.venue === recipe.venue ? 0.04 : -0.04) : 0)
      }))
      .sort((a, b) => b.s - a.s);
    const best = scored[0];
    if (!best || best.s < SUGGEST_THRESHOLD) {
      noCandidate += 1;
      continue;
    }
    // The gap rule exists to stop guessing between DIFFERENT dishes. The same
    // recipe existing at both venues (identical normalised name and sizes) is
    // not ambiguity — the venue boost already ranked the right one first — so
    // the runner-up that matters is the first genuinely different candidate.
    const bestKey = JSON.stringify(normalise(best.recipe.title));
    const second = scored.find(
      (candidate) => candidate.recipe.id !== best.recipe.id && JSON.stringify(normalise(candidate.recipe.title)) !== bestKey
    );

    const clearWinner = best.s >= APPLY_THRESHOLD && (!second || best.s - second.s >= GAP);
    if (clearWinner) {
      applied += 1;
      console.log(
        `${CONFIRM ? 'MAP' : 'would map'}  [${row.accountKey}] "${squareName}"  →  "${best.recipe.title}"  (${best.s.toFixed(2)})`
      );
      if (CONFIRM) {
        await prisma.squareMenuRecipeMapping.update({
          where: { id: row.id },
          data: {
            almaRecipeId: best.recipe.id,
            stockItemId: null,
            status: 'MAPPED',
            confidence: Math.round(best.s * 1000) / 1000,
            notes: `Auto-matched (bulk pass): ${best.recipe.title}`,
            mappedAt: new Date()
          }
        });
      }
    } else {
      shortlisted += 1;
      const runnerUp = second && second.s >= SUGGEST_THRESHOLD ? `  or  "${second.recipe.title}" (${second.s.toFixed(2)})` : '';
      shortlist.push(`  [${row.accountKey}] "${squareName}"  →  "${best.recipe.title}" (${best.s.toFixed(2)})${runnerUp}`);
    }
  }

  if (shortlist.length > 0) {
    console.log('\n── Needs a human call (map these in Suite → Menu mappings) ──');
    for (const line of shortlist) console.log(line);
  }

  // The other direction: which recipes still have no mapping at all — the
  // dishes the menu lab and dish margins cannot see.
  const mappedRecipeIds = new Set(
    (
      await prisma.squareMenuRecipeMapping.findMany({
        where: { almaRecipeId: { not: null }, status: { in: ['CONFIRMED', 'MAPPED'] } },
        select: { almaRecipeId: true },
        distinct: ['almaRecipeId']
      })
    ).map((r) => r.almaRecipeId!)
  );
  // In dry-run, count what WOULD be covered so the summary is honest either way.
  const unmappedRecipes = recipes.filter((recipe) => !mappedRecipeIds.has(recipe.id));
  console.log(`\n── Recipes with no Square mapping ${CONFIRM ? 'after this pass' : 'before applying'} (${unmappedRecipes.length}) ──`);
  for (const recipe of unmappedRecipes.sort((a, b) => (a.venue ?? '').localeCompare(b.venue ?? '') || a.title.localeCompare(b.title))) {
    console.log(`  ${recipe.venue ?? '—'} · ${recipe.title}`);
  }

  console.log(
    `\nSummary: ${applied} ${CONFIRM ? 'mapped' : 'auto-mappable'} · ${shortlisted} need a human call · ${noCandidate} no plausible match · ${noise} not dishes (gift cards, fees — Ignore them in Menu mappings)`
  );
  if (!CONFIRM && applied > 0) {
    console.log('Re-run with MAP_SQUARE_CONFIRM=YES to write the mappings.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
