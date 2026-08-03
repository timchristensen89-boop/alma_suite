/**
 * Add the items a Loaded count found that Alma's catalogue does not have.
 *
 * The St Alma drinks count of 1 August listed 315 items and Alma knew 187 of
 * them. The other 128 are mostly the wine list, which never made it across —
 * which is why a St Alma drinks count could not be complete in Alma however
 * carefully it was taken.
 *
 *   node --import tsx scripts/add-missing-stock-items.ts <sheet.json>
 *   node --import tsx scripts/add-missing-stock-items.ts <sheet.json> --apply
 *
 * Three outcomes per line, and the middle one is the point:
 *
 *   created   Alma has nothing like it, so the item is created
 *   aliased   Alma has it under another wording, so the wording is recorded
 *             against the existing item instead of creating a second one
 *   review    close to something, but not decisively — left for a person
 *
 * Guessing wrong in either direction is quiet and expensive: a duplicate item
 * splits a product's history in two, and an alias onto the wrong product files
 * counts against the wrong shelf. Anything not decisive is printed, not acted on.
 */
import { readFileSync } from 'node:fs';
import { prisma } from '@alma/db';
import {
  parseLoadedStocktake,
  aliasKey,
  catalogueKey,
  classifyAgainstCatalogue,
  newItemShapeFromLoadedUnit,
  type PdfRow
} from '@alma/shared';

/**
 * Loaded's categories to Alma's. Alma splits wine by colour and spirits by
 * type, so a few need the item name to place them.
 */
const CATEGORY: Record<string, string> = {
  Bottled: 'Beer & Cider',
  Keg: 'Beer & Cider',
  'Champagne & Sparkling': 'Wine — Sparkling',
  'Liqueurs & Apertifs': 'Liqueurs & Aperitifs',
  'Non-Alcoholic': 'Non-Alcoholic & Mixers',
  'Other Beverage': 'Non-Alcoholic & Mixers',
  Red: 'Wine — Red',
  White: 'Wine — White',
  Spirits: 'Spirits — Other',
  Breads: 'Bakery',
  Dairy: 'Dairy & Eggs',
  'Dry Goods': 'Dry / Pantry',
  Frozen: 'Frozen',
  Fruit: 'Produce',
  'Herbs and Spices': 'Herbs & Spices',
  Meats: 'Meat & Poultry',
  'Other Food': 'Other',
  Seafood: 'Seafood',
  Vegetables: 'Produce'
};

const DRINK_CATEGORIES = new Set([
  'Bottled',
  'Keg',
  'Champagne & Sparkling',
  'Liqueurs & Apertifs',
  'Non-Alcoholic',
  'Other Beverage',
  'Red',
  'White',
  'Spirits'
]);

const AGAVE = /\b(tequila|mezcal|mescal|espadin|tobala|cuishe|madrecuishe|tobasiche|raicilla|sotol)\b/i;
const ROSE = /\bros[eé]\b/i;

function almaCategory(loadedCategory: string, name: string): string {
  if (loadedCategory === 'Spirits' && AGAVE.test(name)) return 'Spirits — Tequila & Mezcal';
  if ((loadedCategory === 'White' || loadedCategory === 'Red') && ROSE.test(name)) return 'Wine — Rosé';
  return CATEGORY[loadedCategory] ?? 'Other';
}

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  const path = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!path) throw new Error('Usage: add-missing-stock-items.ts <sheet.json> [--apply]');

  const sheet = parseLoadedStocktake(await Promise.resolve(JSON.parse(readFileSync(path, 'utf8')) as PdfRow[]));
  if (sheet.isBlank) {
    console.log('That is a blank count sheet — nothing to add from it.');
    return;
  }
  if (!sheet.venue) throw new Error('The sheet does not name a venue, so new items cannot be placed.');

  const items = await prisma.stockItem.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true }
  });
  const aliases = await prisma.stockItemAlias.findMany({ select: { aliasKey: true, stockItemId: true } });

  const known = new Set<string>();
  for (const item of items) {
    known.add(item.name.trim().toLowerCase());
    known.add(aliasKey(item.name));
    known.add(catalogueKey(item.name));
  }
  for (const alias of aliases) known.add(alias.aliasKey);

  const byName = new Map(items.map((i) => [i.name, i.id]));
  const catalogueNames = items.map((i) => i.name);

  const missing = sheet.lines.filter(
    (line) =>
      !known.has(line.name.trim().toLowerCase()) &&
      !known.has(aliasKey(line.name)) &&
      !known.has(catalogueKey(line.name))
  );

  const toCreate: typeof missing = [];
  const toAlias: Array<{ line: (typeof missing)[number]; match: string; similarity: number }> = [];
  const toReview: Array<{ line: (typeof missing)[number]; match: string; similarity: number }> = [];

  for (const line of missing) {
    const verdict = classifyAgainstCatalogue(line.name, catalogueNames);
    if (verdict.verdict === 'new') toCreate.push(line);
    else if (verdict.verdict === 'same') toAlias.push({ line, match: verdict.match, similarity: verdict.similarity });
    else toReview.push({ line, match: verdict.match, similarity: verdict.similarity });
  }

  console.log(`\n${sheet.venue} — ${sheet.countedAtText ?? 'undated'}`);
  console.log(`  ${sheet.lines.length} counted, ${sheet.lines.length - missing.length} already known, ${missing.length} not\n`);
  console.log(`  create   ${toCreate.length}`);
  console.log(`  alias    ${toAlias.length}   (Alma has these under another wording)`);
  console.log(`  review   ${toReview.length}   (too close to call)`);

  if (toAlias.length > 0) {
    console.log('\n  Recording the Loaded wording against the item Alma already has:');
    for (const a of toAlias) {
      console.log(`    ${a.similarity.toFixed(3)}  ${a.line.name}\n              -> ${a.match}`);
    }
  }

  if (toReview.length > 0) {
    console.log('\n  Close to an existing item, but not close enough to act on. Nothing done:');
    for (const r of toReview.sort((a, b) => b.similarity - a.similarity)) {
      console.log(`    ${r.similarity.toFixed(3)}  ${r.line.name}\n              ? ${r.match}`);
    }
  }

  if (toCreate.length > 0) {
    const byCategory = new Map<string, number>();
    for (const line of toCreate) {
      const category = almaCategory(line.category, line.name);
      byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
    }
    console.log('\n  New items, by the Alma category they land in:');
    for (const [category, count] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(4)}  ${category}`);
    }
    console.log('\n  The dearest of them:');
    for (const line of [...toCreate].sort((a, b) => b.valueCents - a.valueCents).slice(0, 12)) {
      const shape = newItemShapeFromLoadedUnit(line.unit, DRINK_CATEGORIES.has(line.category));
      const cost = line.quantity > 0 ? Math.round(line.valueCents / line.quantity) : null;
      console.log(
        `    ${money(line.valueCents).padStart(11)}  ${line.quantity.toFixed(2).padStart(8)} ${line.unit.padEnd(8)} -> ` +
          `${shape.countUnit.padEnd(7)} @ ${(cost === null ? 'no cost' : money(cost)).padStart(10)}  ${line.name}`
      );
    }
    const noCost = toCreate.filter((l) => l.quantity <= 0).length;
    if (noCost > 0) {
      console.log(
        `\n  ${noCost} of them were counted as zero, so there is no cost to derive. They are created without one.`
      );
    }
  }

  if (!apply) {
    console.log('\n  Dry run. Re-run with --apply.\n');
    return;
  }

  // Categories first, so every item can be filed on creation.
  const categoryIds = new Map<string, string>();
  for (const name of new Set(toCreate.map((line) => almaCategory(line.category, line.name)))) {
    const category = await prisma.stockCategory.upsert({
      where: { name },
      update: {},
      create: { name }
    });
    categoryIds.set(name, category.id);
  }

  let created = 0;
  for (const line of toCreate) {
    const isDrink = DRINK_CATEGORIES.has(line.category);
    const shape = newItemShapeFromLoadedUnit(line.unit, isDrink);
    // The cost Loaded holds, per the unit it counted in — which is the unit the
    // item is being created with, so it is a cost per count unit as Alma means it.
    const cost = line.quantity > 0 ? Math.round(line.valueCents / line.quantity) : null;

    await prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.create({
        data: {
          name: line.name,
          categoryId: categoryIds.get(almaCategory(line.category, line.name)) ?? null,
          unit: shape.unit,
          countUnit: shape.countUnit,
          conversionFactor: shape.conversionFactor,
          measurePerCountUnit: shape.measurePerCountUnit,
          measureUnit: shape.measureUnit,
          countArea: 'Default',
          avgCostCents: cost,
          status: 'ACTIVE',
          notes: `Added from the Loaded count of ${sheet.countedAtText ?? 'an undated sheet'} at ${sheet.venue}.`
        }
      });
      // On hand is left alone: the stocktake sets it when somebody applies it.
      await tx.venueStockItem.create({
        data: { venue: sheet.venue!, stockItemId: item.id, active: true }
      });
      // Record the wording so this line matches straight away next time.
      await tx.stockItemAlias.create({
        data: { aliasKey: aliasKey(line.name), stockItemId: item.id, sourceText: line.name }
      });
    });
    created++;
  }

  let aliased = 0;
  for (const a of toAlias) {
    const stockItemId = byName.get(a.match);
    if (!stockItemId) continue;
    await prisma.stockItemAlias.create({
      data: { aliasKey: aliasKey(a.line.name), stockItemId, sourceText: a.line.name }
    });
    aliased++;
  }

  console.log(`\n  Created ${created} item(s) and recorded ${aliased} alias(es).`);
  console.log(`  ${toReview.length} left for review — nothing was done to those.`);
  console.log('  Re-run the stocktake import to pick them all up.\n');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
