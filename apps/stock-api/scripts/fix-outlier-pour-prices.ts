/**
 * Find the wines priced wrongly by a slip of the finger, and correct them.
 *
 * At Avalon a 150mL glass of Catalina Sounds 'Sound of White' rings at $105
 * against a $76 bottle of the same wine. No list has ever charged more for a
 * glass than a bottle; somebody typed into the wrong box, and it has been
 * sitting there overcharging anyone who orders it by the glass.
 *
 * That is the whole test, and it needs no menu to apply: a pour dearer than a
 * LARGER pour of the same wine is wrong. It cannot fire on a price that is
 * merely unexpected, only on one that contradicts the same bottle.
 *
 * The replacement price comes from the wine's other pours, not from the
 * printed list. The register currently sits about a dollar under the new list
 * everywhere, because the rise is not live until the print is signed off —
 * so writing the menu's $17 onto this glass would bring one pour of one wine
 * forward and leave its own 250mL and 750mL behind. Instead it takes the
 * offset those two already carry and applies it: $17 list, siblings a dollar
 * under, so $16.
 *
 * Both rules are in src/lib/wine-items.ts with tests, because this changes a
 * price staff charge guests.
 *
 *   node --import tsx scripts/fix-outlier-pour-prices.ts
 *   node --import tsx scripts/fix-outlier-pour-prices.ts --apply
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '@alma/db';
import { parseWineList, wineLabel, type WineListRow } from '../src/lib/wine-list.js';
import { impliedPrice, outlierPours, type SiblingPour } from '../src/lib/wine-items.js';

const FILE = resolve(import.meta.dirname, '../../../docs/wine-list.tsv');

type Fix = {
  recipeId: string;
  title: string;
  label: string;
  fromCents: number;
  toCents: number;
  because: string;
};

async function main() {
  const apply = process.argv.includes('--apply');
  const rows: WineListRow[] = parseWineList(readFileSync(FILE, 'utf8'));

  const wines = await prisma.wine.findMany({
    include: { pours: { include: { recipe: { select: { id: true, title: true, status: true, salePriceCents: true } } } } }
  });
  if (wines.length === 0) {
    console.log('No wines in the catalogue yet - run seed-wine-list.ts --apply first.');
    await prisma.$disconnect();
    return;
  }

  // Same identity the seed keys a Wine on, so this is the same wine rather
  // than a second guess at which one it is.
  const key = (venue: string, producer: string, cuvee: string | null, vintage: number | null) =>
    `${venue} ${producer} ${cuvee ?? ''} ${vintage ?? ''}`;
  const byKey = new Map(wines.map((wine) => [key(wine.venue, wine.producer, wine.cuvee, wine.vintage), wine]));

  const fixes: Fix[] = [];
  const unpriceable: string[] = [];

  for (const row of rows) {
    const wine = byKey.get(key(row.venue, row.producer, row.cuvee, row.vintage));
    if (!wine) continue;

    // One entry per pour the list prices AND the register sells, so the
    // comparison is between sizes of the same bottle and nothing else.
    const siblings: Array<SiblingPour & { recipeId: string; title: string }> = [];
    for (const pour of row.pours) {
      const linked = wine.pours.find((candidate) => candidate.ml === pour.ml);
      if (!linked || linked.recipe.status !== 'ACTIVE') continue;
      siblings.push({
        ml: pour.ml,
        menuCents: pour.priceCents,
        registerCents: linked.recipe.salePriceCents,
        recipeId: linked.recipe.id,
        title: linked.recipe.title
      });
    }

    for (const outlier of outlierPours(siblings)) {
      const found = siblings.find((sibling) => sibling.ml === outlier.ml);
      if (!found || found.registerCents === null) continue;
      // Learn only from the pours that are not themselves suspect.
      const sane = siblings.filter((sibling) => !outlierPours(siblings).some((bad) => bad.ml === sibling.ml));
      const target = impliedPrice(found.menuCents, sane);
      if (target === found.registerCents) continue;
      if (sane.length === 0) {
        unpriceable.push(`${wineLabel(row, outlier.ml)} — looks wrong at $${(found.registerCents / 100).toFixed(2)}, but no sane sibling to price it from`);
        continue;
      }
      fixes.push({
        recipeId: found.recipeId,
        title: found.title,
        label: wineLabel(row, outlier.ml),
        fromCents: found.registerCents,
        toCents: target,
        because: sane
          .map((sibling) => `${sibling.ml}mL $${((sibling.registerCents ?? 0) / 100).toFixed(2)}`)
          .join(', ')
      });
    }
  }

  console.log(`${rows.length} wines on the list, ${wines.length} in the catalogue.`);

  if (fixes.length === 0) {
    console.log('\nNo pour is priced above a larger pour of the same wine.');
  } else {
    console.log(`\n${fixes.length} pour(s) priced above a larger pour of the same wine:`);
    for (const fix of fixes) {
      console.log(`  ${fix.label}`);
      console.log(`    ${fix.title}`);
      console.log(
        `    $${(fix.fromCents / 100).toFixed(2)}  ->  $${(fix.toCents / 100).toFixed(2)}` +
          `   (its other pours: ${fix.because})`
      );
    }
  }

  if (unpriceable.length > 0) {
    console.log(`\nWrong but not correctable (${unpriceable.length})`);
    for (const line of unpriceable) console.log(`  ${line}`);
  }

  if (!apply) {
    console.log('\nDry run. Nothing written. Re-run with --apply to set the prices above.');
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  for (const fix of fixes) {
    // Only if it still holds the price this run read. Somebody correcting it
    // by hand in the meantime keeps their number.
    const result = await prisma.recipe.updateMany({
      where: { id: fix.recipeId, salePriceCents: fix.fromCents },
      data: { salePriceCents: fix.toCents }
    });
    written += result.count;
  }
  console.log(`\nRepriced ${written} pour(s).`);
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
