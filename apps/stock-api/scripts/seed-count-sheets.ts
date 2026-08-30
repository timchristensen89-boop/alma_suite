/**
 * The four count sheets Alma actually counts by.
 *
 * `StocktakeTemplate` has zero rows in production, so "Start from template"
 * never renders and every count is seeded from every ACTIVE item — 830 lines.
 * On the first real month-end that put 184 tequilas on the head chef's sheet
 * and 311 food lines on the FOH manager's, and left both progress bars reading
 * "85 / 830 counted (10%)" when the section was finished.
 *
 * The split is by category, which is the only section signal the catalogue
 * carries: `countArea` is 'Default' on all 830 items.
 *
 *   pnpm --filter @alma/stock-api exec tsx scripts/seed-count-sheets.ts          # dry run
 *   pnpm --filter @alma/stock-api exec tsx scripts/seed-count-sheets.ts --apply
 *
 * Idempotent: a template is matched by name + venue and updated in place, so
 * re-running after a category is added just widens the sheet.
 */
import { prisma } from '@alma/db';

const VENUES = ['St Alma', 'Alma Avalon'] as const;

const BAR_CATEGORIES = [
  'Beer & Cider',
  'Liqueurs & Aperitifs',
  'Non-Alcoholic & Mixers',
  'Spirits',
  'Spirits — Other',
  'Spirits — Tequila & Mezcal',
  'Wine',
  'Wine — Red',
  'Wine — Rosé',
  'Wine — Sparkling',
  'Wine — White'
];

const KITCHEN_CATEGORIES = [
  'Bakery',
  'Dairy',
  'Dairy & Eggs',
  'Desserts & Sweets',
  'Dry / Pantry',
  'Dry Goods',
  'Frozen',
  'Herbs & Spices',
  'Meat',
  'Meat & Poultry',
  'Oils & Condiments',
  'Produce',
  'Seafood'
];

// 'Other' and 'Review' are deliberately in neither sheet: 'Review' is the
// triage bucket for items that still need a category, and putting it on a
// counter's sheet asks them to count the mistakes.

async function main() {
  const apply = process.argv.includes('--apply');
  const categories = await prisma.stockCategory.findMany({ select: { id: true, name: true } });
  const idByName = new Map(categories.map((category) => [category.name, category.id]));

  const missing = [...BAR_CATEGORIES, ...KITCHEN_CATEGORIES].filter((name) => !idByName.has(name));
  if (missing.length) {
    console.log(`Categories named here but not in the catalogue (skipped): ${missing.join(', ')}`);
  }

  const uncovered = categories
    .filter((c) => !BAR_CATEGORIES.includes(c.name) && !KITCHEN_CATEGORIES.includes(c.name))
    .map((c) => c.name);
  if (uncovered.length) {
    console.log(`Categories on no sheet: ${uncovered.join(', ')}`);
  }

  for (const venue of VENUES) {
    for (const [section, names] of [
      ['Bar & FOH', BAR_CATEGORIES],
      ['Kitchen', KITCHEN_CATEGORIES]
    ] as const) {
      const categoryIds = names.map((name) => idByName.get(name)).filter((id): id is string => Boolean(id));
      const itemCount = await prisma.stockItem.count({
        where: { status: 'ACTIVE', categoryId: { in: categoryIds } }
      });
      const name = `${venue} — ${section}`;

      if (!apply) {
        console.log(`[dry run] ${name.padEnd(28)} ${categoryIds.length} categories, ${itemCount} items`);
        continue;
      }

      const existing = await prisma.stocktakeTemplate.findFirst({ where: { name, venue } });
      if (existing) {
        await prisma.stocktakeTemplate.update({
          where: { id: existing.id },
          data: { categoryIds, active: true, blindDefault: true }
        });
        console.log(`updated  ${name.padEnd(28)} ${itemCount} items`);
      } else {
        await prisma.stocktakeTemplate.create({
          data: { name, venue, categoryIds, blindDefault: true, active: true }
        });
        console.log(`created  ${name.padEnd(28)} ${itemCount} items`);
      }
    }
  }

  if (!apply) console.log('\nNothing written. Re-run with --apply.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
