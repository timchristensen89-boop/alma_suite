import { prisma } from '@alma/db';

// Give every production (prep) recipe a YIELD QUANTITY + UNIT so prep-recipe
// lines can be costed. Costing does: (batch cost ÷ yield) × qty used. With a
// blank yield there is no denominator, so prep-recipe lines show MISSING.
//
// Heuristic: a batch's yield ≈ the total volume/weight of what goes into it.
// For each recipe we sum its ingredient-line quantities per dimension —
// VOLUME (→ ml), WEIGHT (→ g), COUNT (→ each) — pick the dimension that the
// most lines use (tie → larger total), and set that as the yield. This is a
// STARTING batch size; recipes with real cooking-loss/reduction should be
// nudged down by hand afterwards. We NEVER touch a recipe that already has a
// yield, and (by default) only fill prep recipes.
//
// DRY RUN by default — set YIELD_CONFIRM=YES to write.
//   ./scripts/estimate-recipe-yields.sh
//   YIELD_CONFIRM=YES ./scripts/estimate-recipe-yields.sh
//   ALL_RECIPES=YES ./scripts/estimate-recipe-yields.sh   # also non-prep recipes with blank yield

const CONFIRM = process.env.YIELD_CONFIRM === 'YES';
const ALL_RECIPES = process.env.ALL_RECIPES === 'YES';

type Dim = 'VOLUME' | 'WEIGHT' | 'COUNT';
// unit string -> [dimension, factor to base (ml / g / 1)]
function classifyUnit(raw: string | null): { dim: Dim; factor: number } | null {
  if (!raw) return null;
  const u = raw.trim().toLowerCase().replace(/\.$/, '');
  if (['ml', 'milliliter', 'millilitre', 'milliliters', 'millilitres', 'cc'].includes(u)) return { dim: 'VOLUME', factor: 1 };
  if (['l', 'lt', 'ltr', 'litre', 'liter', 'litres', 'liters'].includes(u)) return { dim: 'VOLUME', factor: 1000 };
  if (['g', 'gm', 'gr', 'gram', 'grams', 'gramme', 'grammes'].includes(u)) return { dim: 'WEIGHT', factor: 1 };
  if (['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'].includes(u)) return { dim: 'WEIGHT', factor: 1000 };
  if (['each', 'ea', 'unit', 'units', 'pc', 'pcs', 'piece', 'pieces', 'portion', 'portions', 'serve', 'serves', 'qty'].includes(u))
    return { dim: 'COUNT', factor: 1 };
  return null; // unknown unit (clove, sprig, bunch, dash…) — ignored for the estimate
}
const round = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const recipes = await prisma.recipe.findMany({
    where: ALL_RECIPES ? {} : { isPrepRecipe: true },
    select: {
      id: true, title: true, isPrepRecipe: true, yieldQuantity: true, yieldUnit: true,
      lines: { select: { quantity: true, unit: true } }
    }
  });

  type Plan = { id: string; title: string; prep: boolean; qty: number; unit: string; dim: Dim; nLines: number; nUsed: number };
  const updates: Plan[] = [];
  let alreadySet = 0, noUsableLines = 0;

  for (const rec of recipes) {
    if (rec.yieldQuantity && rec.yieldQuantity > 0) { alreadySet++; continue; }
    // tally per dimension: base-unit total + how many lines contributed
    const tally: Record<Dim, { total: number; lines: number }> = {
      VOLUME: { total: 0, lines: 0 }, WEIGHT: { total: 0, lines: 0 }, COUNT: { total: 0, lines: 0 }
    };
    for (const line of rec.lines) {
      if (line.quantity == null || line.quantity <= 0) continue;
      const c = classifyUnit(line.unit);
      if (!c) continue;
      tally[c.dim].total += line.quantity * c.factor;
      tally[c.dim].lines += 1;
    }
    const dims = (Object.keys(tally) as Dim[]).filter((d) => tally[d].lines > 0);
    if (dims.length === 0) { noUsableLines++; continue; }
    // dominant = most contributing lines, tie-broken by larger base total
    dims.sort((a, b) => tally[b].lines - tally[a].lines || tally[b].total - tally[a].total);
    const dim = dims[0];
    const baseUnit = dim === 'VOLUME' ? 'ml' : dim === 'WEIGHT' ? 'g' : 'each';
    const qty = round(tally[dim].total);
    if (qty <= 0) { noUsableLines++; continue; }
    updates.push({
      id: rec.id, title: rec.title, prep: rec.isPrepRecipe, qty, unit: baseUnit, dim,
      nLines: rec.lines.length, nUsed: tally[dim].lines
    });
  }

  console.log(`\nScope: ${ALL_RECIPES ? 'ALL recipes' : 'prep recipes only'}`);
  console.log(`Recipes scanned: ${recipes.length} · yield-to-fill ${updates.length} · already-have-yield ${alreadySet} · no-usable-units ${noUsableLines}`);
  console.log('\n=== ESTIMATED YIELDS (batch makes ≈) ===');
  for (const u of updates.slice(0, 80)) {
    console.log(`  ${String(u.qty).padStart(8)} ${u.unit.padEnd(4)} ${`[${u.nUsed}/${u.nLines} lines]`.padEnd(13)} ${u.prep ? 'prep' : 'dish'}  ${u.title.slice(0, 46)}`);
  }
  if (updates.length > 80) console.log(`  …and ${updates.length - 80} more`);

  if (!CONFIRM) {
    console.log(`\nDRY RUN — nothing changed. To apply: YIELD_CONFIRM=YES ./scripts/estimate-recipe-yields.sh`);
    await prisma.$disconnect();
    return;
  }
  let n = 0;
  for (const u of updates) {
    await prisma.recipe.update({ where: { id: u.id }, data: { yieldQuantity: u.qty, yieldUnit: u.unit } });
    n++;
  }
  console.log(`\n✅ Set an estimated yield on ${n} recipes. Refine reduction-heavy batches by hand.`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
