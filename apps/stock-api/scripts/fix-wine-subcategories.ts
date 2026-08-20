/**
 * Take "Cocktails" off the wines, and file them where their neighbours are.
 *
 * A handful of wines came out of the legacy import filed under a subcategory
 * that names a different drink — Loic Mahe's Chenin Blanc and Capa Tempranillo
 * are both down as "Cocktails". That was true before any of this, but
 * create-missing-wine-items.ts then copied its shape from the FIRST neighbour
 * it read back, so those two rows decided how a run of newly created wines at
 * St Alma and Avalon were filed as well. The creator now takes a vote instead
 * (see dominantShape); this cleans up what the old behaviour left behind.
 *
 * It costs nothing at the register — the POS never reads subcategory. Where it
 * shows is Stock: the subcategory is the grey sub-label under the title in the
 * recipe list, and it feeds the search box and the duplicate hint. So a somm
 * searching "cocktails" gets wine back, and a wine reads as a cocktail to
 * anyone scanning the list.
 *
 * The new value is not invented and is not blindly blank. It is the commonest
 * subcategory among the OTHER wines at that venue and category — the same rule
 * the creator now uses — falling back to blank only when there is nothing sane
 * to copy. Blank is a worse label than the right one and a better one than a
 * wrong one.
 *
 * Nothing else is touched: not the title, not the price, not the category,
 * not a subcategory this cannot prove is wrong. An unfamiliar label is unknown,
 * not wrong, and is left exactly as somebody set it.
 *
 *   node --import tsx scripts/fix-wine-subcategories.ts
 *   node --import tsx scripts/fix-wine-subcategories.ts --apply
 *   node --import tsx scripts/fix-wine-subcategories.ts --venue "St Alma"
 */
import { prisma } from '@alma/db';
import { contradictsWine, dominantShape } from '../src/lib/wine-items.js';

type Fix = {
  id: string;
  title: string;
  venue: string;
  category: string;
  from: string;
  to: string | null;
  because: string;
};

async function main() {
  const apply = process.argv.includes('--apply');
  const venueArg = process.argv.indexOf('--venue');
  const onlyVenue = venueArg === -1 ? null : process.argv[venueArg + 1];

  // The same pool create-missing-wine-items.ts works over, so the two scripts
  // agree on what counts as a wine item.
  const recipes = await prisma.recipe.findMany({
    where: {
      status: 'ACTIVE',
      isPrepRecipe: false,
      ...(onlyVenue ? { venue: onlyVenue } : {}),
      OR: [
        { category: { contains: 'Wine', mode: 'insensitive' } },
        { category: { contains: 'Sparkling', mode: 'insensitive' } },
        { category: { contains: 'Rose', mode: 'insensitive' } }
      ]
    },
    select: { id: true, title: true, venue: true, category: true, kind: true, subcategory: true },
    orderBy: [{ venue: 'asc' }, { category: 'asc' }, { title: 'asc' }]
  });

  if (recipes.length === 0) {
    console.log('No wine items in the register.');
    await prisma.$disconnect();
    return;
  }

  const fixes: Fix[] = [];
  for (const recipe of recipes) {
    if (!contradictsWine(recipe.subcategory)) continue;
    const neighbours = recipes.filter(
      (other) => other.id !== recipe.id && other.venue === recipe.venue && other.category === recipe.category
    );
    const shape = dominantShape(neighbours);
    // Only the subcategory. The kind was never the thing that was wrong, and
    // rewriting it here would change what Stock buckets the wine as.
    const to = shape?.subcategory ?? null;
    fixes.push({
      id: recipe.id,
      title: recipe.title,
      venue: recipe.venue ?? '(no venue)',
      category: recipe.category ?? '(no category)',
      from: recipe.subcategory ?? '',
      to,
      because: shape?.subcategory
        ? `most of the ${neighbours.length} other ${recipe.category} at ${recipe.venue} read "${shape.subcategory}"`
        : `none of the ${neighbours.length} other ${recipe.category} at ${recipe.venue} carry a subcategory worth copying`
    });
  }

  console.log(`${recipes.length} wine item(s) in the register${onlyVenue ? ` at ${onlyVenue}` : ''}.`);

  if (fixes.length === 0) {
    console.log('\nNo wine is filed under a subcategory that names something else.');
    await prisma.$disconnect();
    return;
  }

  const labels = [...new Set(fixes.map((fix) => fix.from))].sort();
  console.log(
    `\n${fixes.length} wine(s) filed under a subcategory that names another drink` +
      ` (${labels.map((label) => `"${label}"`).join(', ')}):`
  );

  let heading = '';
  for (const fix of fixes) {
    const key = `${fix.venue} · ${fix.category}`;
    if (key !== heading) {
      heading = key;
      console.log(`\n  ${key}`);
    }
    console.log(`    ${fix.title}`);
    console.log(`      "${fix.from}"  ->  ${fix.to === null ? '(blank)' : `"${fix.to}"`}   — ${fix.because}`);
  }

  if (!apply) {
    console.log('\nDry run. Nothing written. Re-run with --apply to refile the wines above.');
    console.log('No title, price, category or kind is touched either way — only the subcategory.');
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  for (const fix of fixes) {
    // Only if it still reads the way this run read it, so somebody refiling it
    // by hand in the meantime keeps their answer.
    const result = await prisma.recipe.updateMany({
      where: { id: fix.id, subcategory: fix.from },
      data: { subcategory: fix.to }
    });
    written += result.count;
  }

  console.log(`\nRefiled ${written} wine(s).`);
  if (written !== fixes.length) {
    console.log(`${fixes.length - written} had been changed by someone else while this ran, and were left alone.`);
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
