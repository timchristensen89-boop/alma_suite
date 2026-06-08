import { prisma } from '@alma/db';

// Set Recipe.isPrepRecipe = true for every recipe that currently shows up under
// "Prep recipes" via the legacy heuristic (explicit flag OR the "Production
// Recipes" category OR a "production recipe" marker OR a prep-ish keyword in the
// title/category/notes). Once the flag is authoritative, the UI can drop the
// fragile keyword regex without any recipe silently jumping tabs.
//
// DRY RUN by default — set PREP_FLAG_CONFIRM=YES to write. Never clears the flag.
//   ./scripts/backfill-prep-recipe-flag.sh
//   PREP_FLAG_CONFIRM=YES ./scripts/backfill-prep-recipe-flag.sh

const CONFIRM = process.env.PREP_FLAG_CONFIRM === 'YES';

const PRODUCTION_RECIPE_CATEGORY = 'Production Recipes';
const PRODUCTION_RECIPE_MARKER = 'production recipe';
const PREP_KEYWORDS = /\b(prep|batch|sauce|salsa|syrup|marinade|garnish|mise|component|production)\b/;

function looksLikePrep(r: { category: string | null; subcategory: string | null; title: string; notes: string | null }): boolean {
  const value = [r.category ?? '', r.subcategory ?? '', r.title ?? '', r.notes ?? ''].join(' ').toLowerCase();
  return r.category === PRODUCTION_RECIPE_CATEGORY || value.includes(PRODUCTION_RECIPE_MARKER) || PREP_KEYWORDS.test(value);
}

async function main() {
  const recipes = await prisma.recipe.findMany({
    select: { id: true, title: true, category: true, subcategory: true, notes: true, isPrepRecipe: true }
  });

  const toFlag = recipes.filter((r) => !r.isPrepRecipe && looksLikePrep(r));
  const alreadyFlagged = recipes.filter((r) => r.isPrepRecipe).length;

  console.log(`\nRecipes: ${recipes.length} · already flagged ${alreadyFlagged} · will flag ${toFlag.length}`);
  console.log('\n=== will set isPrepRecipe = true ===');
  for (const r of toFlag.slice(0, 60)) {
    const reason = r.category === PRODUCTION_RECIPE_CATEGORY ? 'category' : 'keyword';
    console.log(`  [${reason}] ${r.title.slice(0, 56)}`);
  }
  if (toFlag.length > 60) console.log(`  …and ${toFlag.length - 60} more`);

  if (!CONFIRM) {
    console.log(`\nDRY RUN — nothing changed. To apply: PREP_FLAG_CONFIRM=YES ./scripts/backfill-prep-recipe-flag.sh`);
    await prisma.$disconnect();
    return;
  }
  let n = 0;
  for (const r of toFlag) {
    await prisma.recipe.update({ where: { id: r.id }, data: { isPrepRecipe: true } });
    n++;
  }
  console.log(`\n✅ Flagged ${n} recipes as prep. Prep/Menu classification can now rely on the flag.`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
