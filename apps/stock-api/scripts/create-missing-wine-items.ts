/**
 * Put the wines that are only on paper into the register, so they can be sold.
 *
 * Thirty-seven wines on the printed lists have no register item at all —
 * Taittinger, AIX Rosé, Shaw & Smith, Châteauneuf du Pape — and six more are
 * in the register as a bottle but not as the glass the list prices. A somm can
 * recommend any of them and then has nothing to ring, so either the sale does
 * not happen or it goes through as something else, and the wine report never
 * sees it.
 *
 * What decides that an item is missing is NOT a fresh guess. This runs the
 * same match, over the same pool, in the same order as seed-wine-list.ts, and
 * creates an item only where that script reports "on the list, not in the
 * register". Anything it calls ambiguous or contested is reported here and
 * left alone: two vintages of one bottle is a decision, not a gap.
 *
 * The new item copies its shape — kind, subcategory — from a wine already in
 * the register at that venue and category, so it files itself next to its
 * neighbours rather than in a category of one. Nothing is invented: where the
 * printed list's heading has no home among the register's four wine
 * categories, the wine is reported instead of guessed at.
 *
 * Price is the printed list's price. These wines have never been sold, so
 * there is no register price to preserve and no rise to bring forward — the
 * list is the only number that exists. (Contrast fix-outlier-pour-prices.ts,
 * which is changing a price staff already charge, and follows the wine's
 * siblings instead.)
 *
 * AFTER APPLYING, re-run seed-wine-list.ts --apply. This script creates the
 * register items and stops there; that one owns the Wine catalogue and the
 * pour links, and will pick the new items up on its next pass.
 *
 *   node --import tsx scripts/create-missing-wine-items.ts
 *   node --import tsx scripts/create-missing-wine-items.ts --apply
 *   node --import tsx scripts/create-missing-wine-items.ts --venue "St Alma"
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '@alma/db';
import { poursizeOf, scoreCandidate, tokens } from '../src/lib/wine-match.js';
import { parseWineList, wineLabel, type WineListRow } from '../src/lib/wine-list.js';
import { itemTitle, sectionCategory } from '../src/lib/wine-items.js';

const FILE = resolve(import.meta.dirname, '../../../docs/wine-list.tsv');

// The same two thresholds seed-wine-list.ts uses. Kept in step by hand so the
// two scripts agree on what "already in the register" means; if they drift,
// this one starts creating duplicates of wines that are already there.
const CONFIDENT = 0.62;
const MARGIN = 0.08;

type Planned = {
  row: WineListRow;
  ml: number;
  title: string;
  venue: string;
  category: string;
  priceCents: number;
};

async function main() {
  const apply = process.argv.includes('--apply');
  const venueArg = process.argv.indexOf('--venue');
  const onlyVenue = venueArg === -1 ? null : process.argv[venueArg + 1];

  const rows = parseWineList(readFileSync(FILE, 'utf8')).filter((row) => !onlyVenue || row.venue === onlyVenue);

  const recipes = await prisma.recipe.findMany({
    where: {
      status: 'ACTIVE',
      isPrepRecipe: false,
      OR: [
        { category: { contains: 'Wine', mode: 'insensitive' } },
        { category: { contains: 'Sparkling', mode: 'insensitive' } },
        { category: { contains: 'Rose', mode: 'insensitive' } }
      ]
    },
    select: { id: true, title: true, venue: true, salePriceCents: true, category: true, subcategory: true, kind: true }
  });
  const pool = recipes.map((recipe) => ({ ...recipe, ml: poursizeOf(recipe.title), tokens: tokens(recipe.title) }));

  const planned: Planned[] = [];
  const ambiguous: string[] = [];
  const noCategory: string[] = [];
  const alreadyThere: string[] = [];
  const duplicateTitle: string[] = [];
  const claimed = new Set<string>();
  // Titles the register already has, and titles this run has already planned:
  // two vintages of one wine make the same title, and the second must not
  // become a second tile.
  const existingTitles = new Set(pool.map((recipe) => `${recipe.venue}|${recipe.title.toLowerCase()}`));
  const plannedTitles = new Set<string>();

  for (const row of rows) {
    const maker = tokens(`${row.producer} ${row.cuvee ?? ''}`);
    const wanted = tokens(`${row.producer} ${row.cuvee ?? ''} ${row.grape ?? ''} ${row.section ?? ''}`);

    for (const pour of row.pours) {
      const label = wineLabel(row, pour.ml);
      const candidates = pool
        .filter((recipe) => recipe.venue === row.venue && recipe.ml === pour.ml && !claimed.has(recipe.id))
        .map((recipe) => ({
          recipe,
          score: scoreCandidate({ wanted, maker, title: recipe.title, recipeTokens: recipe.tokens, rowVintage: row.vintage })
        }))
        .sort((a, b) => b.score - a.score);

      const best = candidates[0];
      const next = candidates[1];

      if (best && best.score >= CONFIDENT) {
        if (next && best.score - next.score < MARGIN) {
          // The seeder skips these too. Creating an item would give the wine
          // somewhere to go and quietly leave the real ambiguity in place.
          ambiguous.push(`${label}  →  ${best.recipe.title} vs ${next.recipe.title}`);
          continue;
        }
        claimed.add(best.recipe.id);
        alreadyThere.push(`${label}  →  ${best.recipe.title}`);
        continue;
      }

      // Nothing in the register sells this pour. Can it be filed?
      const category = sectionCategory(row.section);
      if (!category) {
        noCategory.push(`${label} — the list files it under "${row.section ?? '(none)'}", which is none of the register's four`);
        continue;
      }
      const title = itemTitle(row, pour.ml);
      const key = `${row.venue}|${title.toLowerCase()}`;
      if (existingTitles.has(key) || plannedTitles.has(key)) {
        duplicateTitle.push(`${label} — "${title}" already exists at ${row.venue}`);
        continue;
      }
      plannedTitles.add(key);
      planned.push({ row, ml: pour.ml, title, venue: row.venue, category, priceCents: pour.priceCents });
    }
  }

  // Shape copied from a neighbour rather than invented, so a new Shiraz files
  // itself exactly where the register's other Shiraz already sits.
  const template = new Map<string, { kind: string | null; subcategory: string | null; from: string }>();
  for (const plan of planned) {
    const key = `${plan.venue}|${plan.category}`;
    if (template.has(key)) continue;
    const match =
      pool.find((recipe) => recipe.venue === plan.venue && recipe.category === plan.category) ??
      pool.find((recipe) => recipe.venue === plan.venue);
    if (match) template.set(key, { kind: match.kind, subcategory: match.subcategory, from: match.title });
  }

  const report = (title: string, lines: string[]) => {
    if (lines.length === 0) return;
    console.log(`\n${title} (${lines.length})`);
    for (const line of lines) console.log(`  ${line}`);
  };

  console.log(`${rows.length} wines on the list, ${pool.length} wine items in the register.`);
  console.log(`${alreadyThere.length} pour(s) already sellable.`);

  if (planned.length === 0) {
    console.log('\nNothing to create — every pour the list prices has a register item.');
  } else {
    const total = planned.reduce((sum, plan) => sum + plan.priceCents, 0);
    const wines = new Set(planned.map((plan) => `${plan.venue}|${plan.row.producer}|${plan.row.cuvee ?? ''}`)).size;
    console.log(
      `\n${planned.length} new register item(s) across ${wines} wine(s)` +
        ` — $${(total / 100).toFixed(2)} of list price nobody can currently ring.`
    );
    let venue = '';
    for (const plan of planned) {
      if (plan.venue !== venue) {
        venue = plan.venue;
        console.log(`\n  ${venue}`);
      }
      const shape = template.get(`${plan.venue}|${plan.category}`);
      console.log(
        `    ${plan.category.padEnd(14)} $${(plan.priceCents / 100).toFixed(2).padStart(7)}  ${plan.title}` +
          `${shape ? '' : '   [no neighbour to copy — kind and subcategory left blank]'}`
      );
    }
    console.log('\nShape copied from:');
    for (const [key, shape] of template) {
      console.log(`  ${key.padEnd(28)} ${shape.from}  (kind: ${shape.kind ?? 'none'}, subcategory: ${shape.subcategory ?? 'none'})`);
    }
  }

  report('Already in the register — left alone', []);
  report('Ambiguous, so neither matched nor created — needs an eye', ambiguous);
  report('No register category for the list\'s heading — file these by hand', noCategory);
  report('Would collide with an item already there — skipped', duplicateTitle);

  if (!apply) {
    console.log('\nDry run. Nothing written. Re-run with --apply to create the items above.');
    await prisma.$disconnect();
    return;
  }

  let created = 0;
  for (const plan of planned) {
    const shape = template.get(`${plan.venue}|${plan.category}`);
    // Guarded at write time as well: somebody may have added the wine by hand
    // between the read above and here, and theirs wins.
    const clash = await prisma.recipe.findFirst({
      where: { venue: plan.venue, title: plan.title, status: 'ACTIVE' },
      select: { id: true }
    });
    if (clash) continue;
    await prisma.recipe.create({
      data: {
        title: plan.title,
        venue: plan.venue,
        category: plan.category,
        subcategory: shape?.subcategory ?? null,
        kind: shape?.kind ?? null,
        salePriceCents: plan.priceCents,
        isPrepRecipe: false,
        status: 'ACTIVE'
      }
    });
    created += 1;
  }

  console.log(`\nCreated ${created} register item(s).`);
  if (created !== planned.length) {
    console.log(`${planned.length - created} already existed by the time this ran, and were left alone.`);
  }
  console.log('Now re-run seed-wine-list.ts --apply to link them into the wine list.');
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
