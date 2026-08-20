/**
 * Put a cost on every wine the register sells, from the venue stocktake sheets.
 *
 * Every wine item currently carries estimatedCost 0, which is why the wine
 * report's margin columns read "no cost" for the whole list. A report that
 * cannot say what a pour makes is a report nobody uses to buy wine.
 *
 * The costs come from the bar stocktake workbooks in Dropbox (F&B (Austin)/
 * STOCKTAKE/BARS), extracted to docs/wine-costs.tsv — the WINE section only,
 * ex-GST, deduplicated across the workbook's per-period sheets. The sheets
 * also carry a "NOT IN FOODBYUS" section that is mostly mezcal and is
 * deliberately NOT read: it would have costed a Chenin Blanc like a Del
 * Maguey.
 *
 * The sheet prices a BOTTLE. The register sells 150mL, 250mL and 750mL of the
 * same wine, so the bottle price is divided down to the pour — see
 * src/lib/wine-cost.ts, which is tested, because these numbers end in a margin
 * figure Tim buys from.
 *
 * Matching reuses the same scorer as the wine-list seeder, at the same
 * thresholds, so "this stocktake line is that register item" means the same
 * thing here as it does there. Anything ambiguous is reported and left alone.
 *
 *   node --import tsx scripts/cost-wines.ts
 *   node --import tsx scripts/cost-wines.ts --apply
 *   node --import tsx scripts/cost-wines.ts --venue "St Alma"
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '@alma/db';
import { poursizeOf, scoreCandidate, tokens } from '../src/lib/wine-match.js';
import { WINE_CATEGORY_FILTER } from '../src/lib/wine-items.js';
import { pourCost, suspiciousPour } from '../src/lib/wine-cost.js';

const FILE = resolve(import.meta.dirname, '../../../docs/wine-costs.tsv');

// The seeder's thresholds. Kept in step by hand; if they drift, this starts
// costing wines the seeder would call a different wine.
const CONFIDENT = 0.62;
const MARGIN = 0.08;

type CostRow = { venue: string; stockItem: string; bottleCost: number; tokens: Set<string> };
type Planned = { id: string; title: string; venue: string; ml: number; from: string; bottleCost: number; cost: number; was: number };

function parseCosts(text: string): CostRow[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  if (!header?.startsWith('venue')) throw new Error('wine-costs.tsv is missing its header row');
  return lines.flatMap((line) => {
    const [venue, stockItem, cost] = line.split('\t');
    const bottleCost = Number(cost);
    if (!venue || !stockItem || !(bottleCost > 0)) return [];
    return [{ venue, stockItem, bottleCost, tokens: tokens(stockItem) }];
  });
}

async function main() {
  const apply = process.argv.includes('--apply');
  const venueArg = process.argv.indexOf('--venue');
  const onlyVenue = venueArg === -1 ? null : process.argv[venueArg + 1];

  const costs = parseCosts(readFileSync(FILE, 'utf8')).filter((row) => !onlyVenue || row.venue === onlyVenue);

  const recipes = await prisma.recipe.findMany({
    where: { status: 'ACTIVE', isPrepRecipe: false, ...WINE_CATEGORY_FILTER },
    select: { id: true, title: true, venue: true, estimatedCost: true, salePriceCents: true }
  });
  const pool = recipes.filter((recipe) => !onlyVenue || recipe.venue === onlyVenue);

  const planned: Planned[] = [];
  const ambiguous: string[] = [];
  const unmatched: string[] = [];
  const oversized: string[] = [];
  const unchanged: string[] = [];

  for (const recipe of pool) {
    // A wine filed against no venue cannot be costed: the two venues buy the
    // same wine at different prices, so guessing one would be inventing a
    // number rather than reading one.
    if (!recipe.venue) {
      unmatched.push(`(no venue) — ${recipe.title}`);
      continue;
    }
    const ml = poursizeOf(recipe.title);
    const wanted = tokens(recipe.title);
    const candidates = costs
      .filter((row) => row.venue === recipe.venue)
      .map((row) => ({
        row,
        score: scoreCandidate({ wanted, maker: wanted, title: row.stockItem, recipeTokens: row.tokens, rowVintage: null })
      }))
      .sort((a, b) => b.score - a.score);

    const best = candidates[0];
    const next = candidates[1];
    if (!best || best.score < CONFIDENT) {
      unmatched.push(`${recipe.venue} — ${recipe.title}`);
      continue;
    }
    if (next && best.score - next.score < MARGIN) {
      ambiguous.push(`${recipe.venue} — ${recipe.title}  →  ${best.row.stockItem} vs ${next.row.stockItem}`);
      continue;
    }
    if (!ml) {
      unmatched.push(`${recipe.venue} — ${recipe.title} (no pour size in the title)`);
      continue;
    }
    if (suspiciousPour(ml)) {
      oversized.push(`${recipe.venue} — ${recipe.title} — ${ml}mL is bigger than a bottle; the sheet does not say what size it priced`);
      continue;
    }
    const cost = pourCost(best.row.bottleCost, ml);
    if (Math.abs(cost - recipe.estimatedCost) < 0.005) {
      unchanged.push(`${recipe.venue} — ${recipe.title}`);
      continue;
    }
    planned.push({
      id: recipe.id, title: recipe.title, venue: recipe.venue, ml,
      from: best.row.stockItem, bottleCost: best.row.bottleCost, cost, was: recipe.estimatedCost
    });
  }

  const report = (title: string, lines: string[]) => {
    if (lines.length === 0) return;
    console.log(`\n${title} (${lines.length})`);
    for (const line of lines) console.log(`  ${line}`);
  };

  console.log(`${costs.length} costed wines in the stocktake, ${pool.length} wine items in the register.`);
  console.log(`${planned.length} to cost, ${unchanged.length} already correct.`);

  if (planned.length > 0) {
    let venue = '';
    for (const plan of planned.sort((a, b) => a.venue.localeCompare(b.venue) || a.title.localeCompare(b.title))) {
      if (plan.venue !== venue) { venue = plan.venue; console.log(`\n  ${venue}`); }
      console.log(
        `    ${plan.title.padEnd(52)} ${String(plan.ml).padStart(4)}mL  ` +
          `$${plan.cost.toFixed(2).padStart(7)}` +
          `${plan.was > 0 ? `  (was $${plan.was.toFixed(2)})` : ''}` +
          `   ← $${plan.bottleCost.toFixed(2)} a bottle, ${plan.from}`
      );
    }
  }

  report('Ambiguous — two stocktake lines fit equally well, so neither was used', ambiguous);
  report('Pour bigger than a bottle — cost by hand', oversized);
  report('No stocktake line for these — still uncosted', unmatched);

  if (!apply) {
    console.log('\nDry run. Nothing written. Re-run with --apply to set the costs above.');
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  for (const plan of planned) {
    // Only if it still holds the cost this run read, so a cost somebody set by
    // hand between the read and here is kept.
    const result = await prisma.recipe.updateMany({
      where: { id: plan.id, estimatedCost: plan.was },
      data: { estimatedCost: plan.cost }
    });
    written += result.count;
  }
  console.log(`\nCosted ${written} wine item(s).`);
  if (written !== planned.length) {
    console.log(`${planned.length - written} had been changed by someone else while this ran, and were left alone.`);
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
