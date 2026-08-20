/**
 * Give the wines that have NO price in the register the price the printed list
 * charges for them.
 *
 * Twenty-one bottles at St Alma cannot be rung up at all - Sandrone Barolo,
 * Wendouree, Corton Grand Cru, Pol Roger, Billecart-Salmon - about $5,500 of
 * list price that a somm can sell and the register then refuses. Staff work
 * around it or the sale does not happen; either way the wine report never sees
 * it, which is part of why sixty days of wine sales came back empty.
 *
 * The rule, and the reason this is a separate script from the seed:
 *
 *   It ONLY fills in a price where there is none. A recipe that already has a
 *   price is never touched, however far it sits from the menu.
 *
 * That matters because the register and the new printed list disagree on about
 * 116 pours, nearly all by exactly a dollar - the new list's price rise, which
 * is not live until the print is signed off. Repricing those is a decision;
 * making an unsellable bottle sellable is not. This script cannot do the first
 * even if it is pointed at it.
 *
 * Prices come from docs/wine-list.tsv, matched through the Wine records the
 * seed already created, so there is no fuzzy name matching here: a wine either
 * has a linked pour or it is reported as unreachable.
 *
 *   node --import tsx scripts/price-unpriced-wines.ts
 *   node --import tsx scripts/price-unpriced-wines.ts --apply
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '@alma/db';
import { parseWineList, wineLabel, type WineListRow } from '../src/lib/wine-list.js';

const FILE = resolve(import.meta.dirname, '../../../docs/wine-list.tsv');

type Fill = { recipeId: string; title: string; label: string; priceCents: number };

async function main() {
  const apply = process.argv.includes('--apply');
  const rows: WineListRow[] = parseWineList(readFileSync(FILE, 'utf8'));

  const wines = await prisma.wine.findMany({
    include: {
      pours: {
        include: { recipe: { select: { id: true, title: true, status: true, salePriceCents: true } } }
      }
    }
  });
  if (wines.length === 0) {
    console.log('No wines in the catalogue yet - run seed-wine-list.ts --apply first.');
    await prisma.$disconnect();
    return;
  }

  // The seed keys a Wine on exactly these four, so this is the same identity
  // rather than a second guess at it.
  const key = (venue: string, producer: string, cuvee: string | null, vintage: number | null) =>
    `${venue} ${producer} ${cuvee ?? ''} ${vintage ?? ''}`;
  const byKey = new Map(wines.map((wine) => [key(wine.venue, wine.producer, wine.cuvee, wine.vintage), wine]));

  const fills: Fill[] = [];
  const alreadyPriced: string[] = [];
  const noPour: string[] = [];
  const notInCatalogue: string[] = [];
  const inactive: string[] = [];

  for (const row of rows) {
    const wine = byKey.get(key(row.venue, row.producer, row.cuvee, row.vintage));
    if (!wine) {
      // Only worth reporting for wines the list actually prices.
      if (row.pours.length > 0) notInCatalogue.push(wineLabel(row));
      continue;
    }
    for (const pour of row.pours) {
      const linked = wine.pours.find((candidate) => candidate.ml === pour.ml);
      if (!linked) {
        noPour.push(`${wineLabel(row, pour.ml)} - menu says $${(pour.priceCents / 100).toFixed(2)}`);
        continue;
      }
      if (linked.recipe.status !== 'ACTIVE') {
        inactive.push(`${wineLabel(row, pour.ml)} - ${linked.recipe.title} is ${linked.recipe.status.toLowerCase()}`);
        continue;
      }
      if (linked.recipe.salePriceCents !== null) {
        // Reported so the gap is visible, never written.
        if (linked.recipe.salePriceCents !== pour.priceCents) {
          alreadyPriced.push(
            `${wineLabel(row, pour.ml)}: register $${(linked.recipe.salePriceCents / 100).toFixed(2)}` +
              ` vs menu $${(pour.priceCents / 100).toFixed(2)}`
          );
        }
        continue;
      }
      fills.push({
        recipeId: linked.recipe.id,
        title: linked.recipe.title,
        label: wineLabel(row, pour.ml),
        priceCents: pour.priceCents
      });
    }
  }

  const report = (title: string, lines: string[]) => {
    if (lines.length === 0) return;
    console.log(`\n${title} (${lines.length})`);
    for (const line of lines) console.log(`  ${line}`);
  };

  console.log(`${rows.length} wines on the list, ${wines.length} in the catalogue.`);
  if (fills.length === 0) {
    console.log('\nNothing to price - every linked pour already has a price.');
  } else {
    const total = fills.reduce((sum, fill) => sum + fill.priceCents, 0);
    console.log(
      `\n${fills.length} pour(s) have no price and the list has one` +
        ` - $${(total / 100).toFixed(2)} of wine that cannot currently be rung up.`
    );
    for (const fill of fills) {
      console.log(`  ${fill.label}  ->  $${(fill.priceCents / 100).toFixed(2)}   (${fill.title})`);
    }
  }

  report('On the list and in the catalogue, but that pour is not linked to a register item', noPour);
  report('Linked to an item that is not active', inactive);
  report('On the list but not in the catalogue - re-run seed-wine-list.ts', notInCatalogue);
  report('Already priced, and the register disagrees with the menu - LEFT ALONE', alreadyPriced);

  if (!apply) {
    console.log('\nDry run. Nothing written. Re-run with --apply to set the prices above.');
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  for (const fill of fills) {
    // Guarded again at write time: there is a small window between the read
    // above and here, and a price someone set by hand in it must win.
    const result = await prisma.recipe.updateMany({
      where: { id: fill.recipeId, salePriceCents: null },
      data: { salePriceCents: fill.priceCents }
    });
    written += result.count;
  }
  console.log(`\nPriced ${written} pour(s).`);
  if (written !== fills.length) {
    console.log(`${fills.length - written} were priced by someone else while this ran, and were left alone.`);
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
