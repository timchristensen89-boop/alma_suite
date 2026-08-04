/**
 * Settle the names the catalogue backfill would not decide on its own.
 *
 * `add-missing-stock-items.ts` creates what is clearly new and records a wording
 * against what is clearly the same, and prints everything in between rather than
 * guessing — because closeness cannot separate the two cases. "First Press Cold
 * Drip Coffee Mixer" and "First Press **Black** Cold Drip Coffee Mixer" score
 * 0.85 and are one product; "Bruxo No. 2" and "Bruxo No. 4" score 0.90 and are
 * two mezcals.
 *
 * Seventeen names came back for review across the two counts of 1–2 August.
 * The calls below are recorded here so the reasoning survives with them.
 *
 *   node --import tsx scripts/apply-catalogue-decisions.ts <sheet.json>
 *   node --import tsx scripts/apply-catalogue-decisions.ts <sheet.json> --apply
 */
import { readFileSync } from 'node:fs';
import { prisma } from '@alma/db';
import { parseLoadedStocktake, aliasKey, newItemShapeFromLoadedUnit, type PdfRow } from '@alma/shared';

type Decision =
  /** The same product Alma already holds — record the wording, do not duplicate. */
  | { action: 'alias'; loaded: string; target: string; because: string }
  /** Genuinely a different product — create it. */
  | { action: 'create'; loaded: string; category: string; because: string }
  /** Alma's own name is wrong — fix it, and the wordings then agree. */
  | { action: 'rename'; loaded: string; target: string; to: string; because: string };

const DECISIONS: Decision[] = [
  // ——— Spelling and spacing ———
  { action: 'alias', loaded: 'ArteNom1579', target: 'ArteNom 1579', because: 'Missing space, same tequila.' },
  {
    action: 'alias',
    loaded: 'Inama Vin Soave Classico',
    target: 'Inama Soave Classico',
    because: '"Vin" is on the label, not in the product.'
  },

  // ——— Alma's name carries the vintage and case size, Loaded's does not ———
  {
    action: 'alias',
    loaded: 'Domaine Christian Salmon Sancerre',
    target: '2024 Domaine Christian Salmon Sancerre AC (Case of 12)',
    because: 'Same Sancerre; the AC and the case size describe the packet.'
  },
  {
    action: 'alias',
    loaded: 'Laurent Perrier Brut Rose',
    target: 'NV Laurent Perrier Brut Rose (Case of 6)',
    because: 'Non-vintage champagne, so NV is not a year that could differ.'
  },
  {
    action: 'alias',
    loaded: 'Ramos Pinto Duas Quintas Vinho Tinto',
    target: '2022 Ramos Pinto Duas Quintas Tinto (Case of 6)',
    because: '"Vinho Tinto" and "Tinto" are the same wine.'
  },

  // ——— Loaded carries a word Alma does not, or the reverse ———
  {
    action: 'alias',
    loaded: 'Ron Santiago de Cuba Carta Blanca Rum',
    target: 'Ron Santiago de Cuba Carta Blanca',
    because: 'Trailing "Rum" only.'
  },
  {
    action: 'alias',
    loaded: 'Ron Santiago de Cuba 8yo Rum',
    target: 'Ron Santiago de Cuba 8yo',
    because: 'Trailing "Rum" only; the age matches.'
  },
  {
    action: 'alias',
    loaded: 'First Press Cold Drip Coffee Mixer',
    target: 'First Press Black Cold Drip Coffee Mixer',
    because: 'Only one First Press cold drip is stocked.'
  },
  {
    action: 'alias',
    loaded: 'Heaps Normal Another Lager Can',
    target: 'Heaps Normal Another Lager',
    because: 'Sold in cans only, so "Can" adds nothing.'
  },

  // ——— Alma's name states a size that is the only size stocked ———
  {
    action: 'alias',
    loaded: 'Spicy Pineapple Margarita Keg',
    target: 'Spicy Pineapple Margarita Keg 20L',
    because: 'The 20L is the keg.'
  },
  {
    action: 'alias',
    loaded: 'Vandal Gonzo Militia White Blend',
    target: 'Vandal Gonzo Militia White Blend 750mL',
    because: '750mL is the standard bottle, already the count unit.'
  },
  {
    action: 'alias',
    loaded: 'Tomato Ketchup',
    target: 'Tomato Ketchup 1L',
    because: 'One ketchup line; the 1L is the pack.'
  },
  {
    action: 'alias',
    loaded: 'Garlic Peeled Bag',
    target: 'Garlic Peeled 1kg Bag',
    because: 'One peeled-garlic line; the 1kg is the bag.'
  },

  // ——— Alma's own name is damaged ———
  {
    action: 'rename',
    loaded: 'Cauliflower',
    target: 'Cauli fl ower',
    to: 'Cauliflower',
    because:
      'Created by an earlier PDF import that split the "fl" ligature into its own text run. Fixing the name is better than aliasing onto a broken one.'
  },

  // ——— Close, but genuinely different products ———
  {
    action: 'create',
    loaded: 'Bruxo No. 2',
    category: 'Spirits — Tequila & Mezcal',
    because: 'Alma holds Bruxo No. 4. The number is the expression — a different mezcal.'
  },
  {
    action: 'create',
    loaded: 'Lyres Agave Blanco',
    category: 'Non-Alcoholic & Mixers',
    because: "Matched against Tres Agaves Blanco, but Lyre's is the non-alcoholic spirit."
  },
  {
    action: 'create',
    loaded: 'Greywacke Sauvignon Blanc (375mL)',
    category: 'Wine — White',
    because: 'Alma holds the 750mL. A half bottle is a separate line with its own cost.'
  }
];

const DRINK_CATEGORIES = new Set(['Wine — White', 'Wine — Red', 'Spirits — Tequila & Mezcal', 'Non-Alcoholic & Mixers']);

async function main() {
  const path = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!path) throw new Error('Usage: apply-catalogue-decisions.ts <sheet.json> [--apply]');

  const sheet = parseLoadedStocktake(JSON.parse(readFileSync(path, 'utf8')) as PdfRow[]);
  const lines = new Map(sheet.lines.map((line) => [line.name, line]));

  let aliased = 0;
  let created = 0;
  let renamed = 0;
  let skipped = 0;

  for (const decision of DECISIONS) {
    const line = lines.get(decision.loaded);
    if (!line) continue; // belongs to the other sheet

    if (decision.action === 'rename') {
      const item = await prisma.stockItem.findFirst({ where: { name: decision.target } });
      if (!item) {
        console.log(`  skip    ${decision.loaded} — "${decision.target}" is not in the catalogue`);
        skipped++;
        continue;
      }
      console.log(`  rename  "${decision.target}" -> "${decision.to}"\n            ${decision.because}`);
      if (apply) await prisma.stockItem.update({ where: { id: item.id }, data: { name: decision.to } });
      renamed++;
      continue;
    }

    if (decision.action === 'alias') {
      const item = await prisma.stockItem.findFirst({ where: { name: decision.target } });
      if (!item) {
        console.log(`  skip    ${decision.loaded} — "${decision.target}" is not in the catalogue`);
        skipped++;
        continue;
      }
      const key = aliasKey(decision.loaded);
      const already = await prisma.stockItemAlias.findFirst({ where: { aliasKey: key, supplierId: null } });
      if (already) {
        skipped++;
        continue;
      }
      console.log(`  alias   ${decision.loaded}\n            -> ${decision.target}\n            ${decision.because}`);
      if (apply) {
        await prisma.stockItemAlias.create({
          data: { aliasKey: key, stockItemId: item.id, sourceText: decision.loaded }
        });
      }
      aliased++;
      continue;
    }

    // create
    const existing = await prisma.stockItem.findFirst({ where: { name: decision.loaded } });
    if (existing) {
      skipped++;
      continue;
    }
    const shape = newItemShapeFromLoadedUnit(line.unit, DRINK_CATEGORIES.has(decision.category));
    const cost = line.quantity > 0 ? Math.round(line.valueCents / line.quantity) : null;
    console.log(
      `  create  ${decision.loaded}\n            ${decision.category}, ${shape.countUnit}` +
        `${cost === null ? ', no cost (counted zero)' : `, $${(cost / 100).toFixed(2)} each`}\n            ${decision.because}`
    );
    if (apply) {
      const category = await prisma.stockCategory.upsert({
        where: { name: decision.category },
        update: {},
        create: { name: decision.category }
      });
      await prisma.$transaction(async (tx) => {
        const item = await tx.stockItem.create({
          data: {
            name: decision.loaded,
            categoryId: category.id,
            unit: shape.unit,
            countUnit: shape.countUnit,
            conversionFactor: shape.conversionFactor,
            measurePerCountUnit: shape.measurePerCountUnit,
            measureUnit: shape.measureUnit,
            countArea: 'Default',
            avgCostCents: cost,
            status: 'ACTIVE',
            notes: `Added from the Loaded count of ${sheet.countedAtText ?? 'an undated sheet'} at ${sheet.venue}. ${decision.because}`
          }
        });
        await tx.venueStockItem.create({ data: { venue: sheet.venue!, stockItemId: item.id, active: true } });
        await tx.stockItemAlias.create({
          data: { aliasKey: aliasKey(decision.loaded), stockItemId: item.id, sourceText: decision.loaded }
        });
      });
    }
    created++;
  }

  console.log(
    `\n  ${apply ? 'Applied' : 'Would apply'}: ${aliased} alias(es), ${created} new item(s), ${renamed} rename(s).` +
      (skipped > 0 ? ` ${skipped} already settled.` : '')
  );
  if (!apply) console.log('  Dry run. Re-run with --apply.\n');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
