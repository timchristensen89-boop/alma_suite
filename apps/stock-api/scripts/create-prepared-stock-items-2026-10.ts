/**
 * Set up Batch Cocktails and Kitchen Prep: one prepared-stock item for each
 * prep recipe that has been counted (or every active prep recipe with --all).
 *
 *   DATABASE_URL=… tsx scripts/create-prepared-stock-items-2026-10.ts            # dry run
 *   DATABASE_URL=… tsx scripts/create-prepared-stock-items-2026-10.ts --apply
 *   DATABASE_URL=… tsx scripts/create-prepared-stock-items-2026-10.ts --rollback <runId>
 *   DATABASE_URL=… tsx scripts/create-prepared-stock-items-2026-10.ts --links <file> [--apply-links]
 *   DATABASE_URL=… tsx scripts/create-prepared-stock-items-2026-10.ts --recipes <file> [--apply-recipes]
 *   DATABASE_URL=… tsx scripts/create-prepared-stock-items-2026-10.ts --prune-leftovers [--apply-prune]
 *   DATABASE_URL=… tsx scripts/create-prepared-stock-items-2026-10.ts --refresh-costs [--apply-refresh]
 *
 * Each item: the recipe's title (with " — <venue>" when two venues share a
 * title), in Batch Cocktails (batches, syrups, cordials) or Kitchen Prep
 * (everything else), counted in L for a volume yield and kg for a weight
 * yield, with a standard container the size of one batch as made and a cost
 * per L/kg from the recipe. Linked to the recipe, so the old prep-line count
 * of it stops (no double counting). A venue row is created at the recipe's
 * venue with NO on-hand: the 1 Oct counts already credited what was in the
 * batches to the raw ingredients, so seeding a quantity here would count it
 * twice. The next count sets both.
 *
 * The two sections are added to each venue's templates (Batch Cocktails to
 * Bar & FOH, Kitchen Prep to Kitchen) so they appear on counts, printed
 * sheets and Excel.
 *
 * Every created row and every template change is recorded in
 * _stock_prepared_items_backup; --rollback deletes the created items (refused
 * if anything has been counted, moved or costed against them since, unless
 * --force) and restores the templates. Writes to a non-local database need
 * --i-mean-production.
 */
import { prisma } from '@alma/db';
import { convertBetweenUnits, normaliseUnitLabel } from '@alma/shared';
import { prepRecipeBatchCost, refreshRecipeCosts } from '../src/services/recipes.service.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const TABLE = '_stock_prepared_items_backup';
const BAR_SECTION = 'Batch Cocktails';
const KITCHEN_SECTION = 'Kitchen Prep';
const BAR_TITLE = /\b(batch|syrup|cordial|shrub|sour mix|infusion|infused|spiced tequila)\b/i;
const dollars = (cents: number | null) => (cents === null ? '—' : `$${(cents / 100).toFixed(2)}`);

type Planned = {
  recipeId: string;
  title: string;
  venue: string | null;
  section: string;
  name: string;
  countUnit: string;
  containerSize: number | null;
  avgCostCents: number | null;
  problems: string[];
};

async function assertFreshRun(runId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "${TABLE}" WHERE "runId" = $1`, runId);
  if ((rows[0]?.n ?? 0) > 0) throw new Error(`Run id "${runId}" was already used; rollback would restore both runs at once. Pick a new --run-id.`);
}

async function ensureTable() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${TABLE}" (id bigserial PRIMARY KEY, "runId" text NOT NULL, kind text NOT NULL, "rowId" text NOT NULL, payload jsonb NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now())`);
}

async function plan(all: boolean): Promise<Planned[]> {
  const recipes = await prisma.recipe.findMany({
    where: {
      status: 'ACTIVE',
      isPrepRecipe: true,
      prepStockItems: { none: {} },
      ...(all ? {} : { stocktakeLines: { some: { countedQty: { not: null } } } })
    },
    select: { id: true, title: true, venue: true, yieldQuantity: true, yieldUnit: true },
    orderBy: [{ title: 'asc' }, { venue: 'asc' }]
  });
  const titleCount = new Map<string, number>();
  for (const r of recipes) titleCount.set(r.title.trim().toLowerCase(), (titleCount.get(r.title.trim().toLowerCase()) ?? 0) + 1);
  const taken = new Set((await prisma.stockItem.findMany({ select: { name: true } })).map((i) => i.name.trim().toLowerCase()));
  const out: Planned[] = [];
  for (const r of recipes) {
    const problems: string[] = [];
    const yieldUnit = normaliseUnitLabel(r.yieldUnit);
    const countUnit = yieldUnit === 'ml' || yieldUnit === 'l' ? 'L' : yieldUnit === 'g' || yieldUnit === 'kg' ? 'kg' : null;
    if (!countUnit) problems.push(`yield is "${r.yieldQuantity ?? '?'} ${r.yieldUnit ?? 'no unit'}" — needs a litre or kilo yield before it can be counted by volume or weight`);
    const containerSize = countUnit && r.yieldQuantity ? convertBetweenUnits(r.yieldQuantity, r.yieldUnit, countUnit) : null;
    const cost = await prepRecipeBatchCost(r.id);
    let avgCostCents = cost?.batchCostCents != null && containerSize ? Math.round(cost.batchCostCents / containerSize) : null;
    // A recipe cost this high almost always means an ingredient is costed
    // wrong (a case price on a bottle, a 100 g placeholder on a 10 kg bag).
    // Leave it blank and say so rather than book it.
    const ceiling = countUnit === 'L' ? 10000 : 6000;
    if (avgCostCents !== null && avgCostCents > ceiling) {
      problems.push(`recipe says ${dollars(avgCostCents)} per ${countUnit} — an ingredient cost looks wrong; cost left blank`);
      avgCostCents = null;
    }
    // A partial cost understates the batch, so it is never booked: the item is
    // created with no cost and the missing ingredients are named.
    if (countUnit && cost && cost.uncostedLines > 0 && avgCostCents !== null) {
      problems.push(`no cost for ${cost.uncostedIngredients.map((n) => `"${n}"`).join(', ')} — cost left blank until it is costed or linked`);
      avgCostCents = null;
    }
    if (countUnit && avgCostCents === null && !problems.length) problems.push('no ingredient has a cost — cost per unit left blank');
    let name = r.title.trim();
    if ((titleCount.get(name.toLowerCase()) ?? 0) > 1 && r.venue) name = `${name} — ${r.venue}`;
    if (taken.has(name.toLowerCase())) problems.push(`an item called "${name}" already exists`);
    out.push({
      recipeId: r.id,
      title: r.title,
      venue: r.venue,
      section: BAR_TITLE.test(r.title) ? BAR_SECTION : KITCHEN_SECTION,
      name,
      countUnit: countUnit ?? '',
      containerSize: containerSize ? Math.round(containerSize * 1000) / 1000 : null,
      avgCostCents,
      problems
    });
  }
  return out;
}

async function apply(runId: string, rows: Planned[]) {
  const sections = await prisma.stockCategory.findMany({ where: { name: { in: [BAR_SECTION, KITCHEN_SECTION] } } });
  const sectionId = new Map(sections.map((s) => [s.name, s.id]));
  if (sectionId.size < 2) throw new Error('The Batch Cocktails / Kitchen Prep categories are missing — run the migration first');
  const ready = rows.filter((r) => r.countUnit && !r.problems.some((p) => p.startsWith('an item called')));
  // A blank cost does not block creation: the manager types it, or presses
  // "Use recipe cost" once the ingredients are costed.
  await prisma.$transaction(async (tx) => {
    for (const r of ready) {
      const item = await tx.stockItem.create({
        data: {
          name: r.name,
          categoryId: sectionId.get(r.section)!,
          unit: 'container',
          countUnit: r.countUnit,
          conversionFactor: r.containerSize && r.containerSize > 0 ? r.containerSize : 1,
          prepRecipeId: r.recipeId,
          avgCostCents: r.avgCostCents,
          countArea: r.section,
          status: 'ACTIVE',
          notes: `Prepared from the recipe "${r.title}"${r.venue ? ` (${r.venue})` : ''}. Created by create-prepared-stock-items-2026-10 run ${runId}.`
        }
      });
      if (r.venue) await tx.venueStockItem.create({ data: { venue: r.venue, stockItemId: item.id, onHand: null, active: true } });
      await tx.$executeRawUnsafe(`INSERT INTO "${TABLE}" ("runId",kind,"rowId",payload) VALUES ($1,'item',$2,$3::jsonb)`, runId, item.id, JSON.stringify(r));
    }
    const templates = await tx.stocktakeTemplate.findMany({ where: { active: true } });
    for (const t of templates) {
      const want = /kitchen/i.test(t.name) ? sectionId.get(KITCHEN_SECTION)! : sectionId.get(BAR_SECTION)!;
      if (t.categoryIds.includes(want)) continue;
      await tx.$executeRawUnsafe(`INSERT INTO "${TABLE}" ("runId",kind,"rowId",payload) VALUES ($1,'template',$2,$3::jsonb)`, runId, t.id, JSON.stringify({ categoryIds: t.categoryIds, updatedAt: t.updatedAt }));
      await tx.stocktakeTemplate.update({ where: { id: t.id }, data: { categoryIds: [...t.categoryIds, want] } });
    }
  }, { timeout: 120_000 });
  return ready.length;
}

type LinkFix = { lineId: string; recipe: string; expectNow: Record<string, unknown>; set: Record<string, unknown>; why: string };

/**
 * Recipe-line links that make a batch's cost complete: a line the import left
 * unlinked ("Coconut Washed", "Chicken Adobo") pointed at the prep recipe it
 * names. Checked against what was reviewed, snapshotted, then written. Run
 * before the dry run so the plan's costs include them.
 */
async function applyLinks(runId: string, file: string) {
  const fs = await import('node:fs');
  const fixes = JSON.parse(fs.readFileSync(file, 'utf8')) as LinkFix[];
  const problems: string[] = [];
  for (const f of fixes) {
    const line = (await prisma.recipeLine.findUnique({ where: { id: f.lineId } })) as unknown as Record<string, unknown> | null;
    if (!line) { problems.push(`${f.recipe}: line ${f.lineId} is gone`); continue; }
    for (const [k, v] of Object.entries(f.expectNow)) if ((line[k] ?? null) !== v) problems.push(`${f.recipe}: ${k} is ${String(line[k])}, reviewed ${String(v)}`);
    if (typeof f.set.subRecipeId === 'string') {
      const sub = await prisma.recipe.findUnique({ where: { id: f.set.subRecipeId }, select: { isPrepRecipe: true, status: true } });
      if (!sub?.isPrepRecipe || sub.status !== 'ACTIVE') problems.push(`${f.recipe}: ${f.set.subRecipeId} is not an active prep recipe`);
    }
  }
  for (const f of fixes) console.log(`  ${f.recipe}: ${JSON.stringify(f.expectNow)} → ${JSON.stringify(f.set)}\n      ${f.why}`);
  if (problems.length) throw new Error(`REFUSED:\n  ${problems.join('\n  ')}`);
  if (!flag('--apply-links')) { console.log('Links checked — nothing written. Re-run with --apply-links.'); return; }
  await assertFreshRun(runId);
  const recipeIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const f of fixes) {
      const before = await tx.recipeLine.findUniqueOrThrow({ where: { id: f.lineId } });
      recipeIds.push(before.recipeId);
      await tx.$executeRawUnsafe(`INSERT INTO "${TABLE}" ("runId",kind,"rowId",payload) VALUES ($1,'recipeLine',$2,$3::jsonb)`, runId, f.lineId, JSON.stringify(before));
      await tx.recipeLine.update({ where: { id: f.lineId }, data: f.set });
    }
  });
  const refreshed = await refreshRecipeCosts(recipeIds);
  console.log(`Applied links run ${runId}: ${fixes.length} recipe line(s); ${refreshed.recipesRefreshed} recipe cost(s) refreshed. Rollback: --rollback ${runId}`);
}

type RecipeFix = { recipeId: string; recipe: string; expectNow: Record<string, unknown>; set: Record<string, unknown>; why: string };

/**
 * Recipe-level corrections (a prep recipe's finished yield, for example),
 * checked against what was reviewed, snapshotted, then written. Costing
 * reads the yield, so a batch cost is spread over the right number of grams.
 */
async function applyRecipes(runId: string, file: string) {
  const fs = await import('node:fs');
  const fixes = JSON.parse(fs.readFileSync(file, 'utf8')) as RecipeFix[];
  const problems: string[] = [];
  for (const f of fixes) {
    const recipe = (await prisma.recipe.findUnique({ where: { id: f.recipeId } })) as unknown as Record<string, unknown> | null;
    if (!recipe) { problems.push(`${f.recipe}: recipe ${f.recipeId} is gone`); continue; }
    for (const [k, v] of Object.entries(f.expectNow)) if ((recipe[k] ?? null) !== v) problems.push(`${f.recipe}: ${k} is ${String(recipe[k])}, reviewed ${String(v)}`);
  }
  for (const f of fixes) console.log(`  ${f.recipe}: ${JSON.stringify(f.expectNow)} → ${JSON.stringify(f.set)}\n      ${f.why}`);
  if (problems.length) throw new Error(`REFUSED:\n  ${problems.join('\n  ')}`);
  if (!flag('--apply-recipes')) { console.log(`${fixes.length} recipe(s) checked — nothing written. Re-run with --apply-recipes.`); return; }
  await assertFreshRun(runId);
  await prisma.$transaction(async (tx) => {
    for (const f of fixes) {
      const before = await tx.recipe.findUniqueOrThrow({ where: { id: f.recipeId } });
      await tx.$executeRawUnsafe(`INSERT INTO "${TABLE}" ("runId",kind,"rowId",payload) VALUES ($1,'recipe',$2,$3::jsonb)`, runId, f.recipeId, JSON.stringify(before));
      await tx.recipe.update({ where: { id: f.recipeId }, data: f.set });
    }
  });
  const refreshed = await refreshRecipeCosts(fixes.map((f) => f.recipeId));
  console.log(`Applied recipes run ${runId}: ${fixes.length} recipe(s); ${refreshed.recipesRefreshed} recipe cost(s) refreshed. Rollback: --rollback ${runId}`);
}

// The recipe import turned each recipe's portion and yield notes into lines of
// their own — "(280 portions)", "100 g", "2.1 kg" — with nothing behind them.
// They are not ingredients, but costing treats a line with no cost as a
// missing cost, so every recipe carrying one never refreshes its stored cost.
const LEFTOVER = /^\(?\s*[\d.]+\s*(portions?|ml|l|g|kg|units?)?\s*\)?$/i;

async function pruneLeftovers(runId: string) {
  const lines = await prisma.recipeLine.findMany({
    where: { itemId: null, subRecipeId: null, recipe: { status: 'ACTIVE' } },
    include: { recipe: { select: { title: true, venue: true } } }
  });
  const leftovers = lines.filter((l) => LEFTOVER.test(l.ingredientName.trim()) || (l.quantity === null && l.unit === null && !/[a-z]{3,}/i.test(l.ingredientName.replace(/portions?|units?|ml|kg|g|l/gi, ''))));
  const byVenue = new Map<string, number>();
  for (const l of leftovers) byVenue.set(l.recipe.venue ?? 'no venue', (byVenue.get(l.recipe.venue ?? 'no venue') ?? 0) + 1);
  console.log(`${leftovers.length} import-leftover line(s) across ${new Set(leftovers.map((l) => l.recipeId)).size} recipe(s): ${Array.from(byVenue).map(([v, n]) => `${v} ${n}`).join(', ')}`);
  for (const l of leftovers.slice(0, 12)) console.log(`  e.g. ${l.recipe.title}: "${l.ingredientName}" ${l.quantity ?? ''} ${l.unit ?? ''}`);
  const kept = lines.filter((l) => !leftovers.includes(l));
  console.log(`${kept.length} unlinked line(s) with a real name are kept, e.g. ${kept.slice(0, 5).map((l) => `"${l.ingredientName}"`).join(', ')}`);
  if (!flag('--apply-prune')) { console.log('Nothing written. Re-run with --apply-prune.'); return; }
  await assertFreshRun(runId);
  await prisma.$transaction(async (tx) => {
    for (const l of leftovers) {
      const { recipe: _r, ...row } = l;
      await tx.$executeRawUnsafe(`INSERT INTO "${TABLE}" ("runId",kind,"rowId",payload) VALUES ($1,'recipeLineDeleted',$2,$3::jsonb)`, runId, l.id, JSON.stringify(row));
      await tx.recipeLine.delete({ where: { id: l.id } });
    }
  }, { timeout: 120_000 });
  const refreshed = await refreshRecipeCosts(Array.from(new Set(leftovers.map((l) => l.recipeId))));
  console.log(`Applied prune run ${runId}: ${leftovers.length} line(s) removed; ${refreshed.recipesRefreshed} recipe cost(s) refreshed. Rollback: --rollback ${runId}`);
}

// Stored recipe costs are refreshed on edits only, so a recipe nobody has
// touched since an ingredient's cost changed shows a stale figure on the
// margin page. Recompute every active recipe's stored cost (derived data;
// re-runnable; nothing to roll back).
async function refreshAllCosts() {
  const recipes = await prisma.recipe.findMany({ where: { status: 'ACTIVE' }, select: { id: true, title: true, venue: true, estimatedCost: true } });
  const before = new Map(recipes.map((r) => [r.id, r.estimatedCost]));
  if (!flag('--apply-refresh')) { console.log(`${recipes.length} active recipe(s) would be refreshed. Re-run with --apply-refresh.`); return; }
  const result = await refreshRecipeCosts(recipes.map((r) => r.id));
  const after = await prisma.recipe.findMany({ where: { id: { in: recipes.map((r) => r.id) } }, select: { id: true, title: true, venue: true, estimatedCost: true } });
  const changed = after.filter((r) => Math.abs((r.estimatedCost ?? 0) - (before.get(r.id) ?? 0)) > 0.005);
  console.log(`Refreshed ${result.recipesRefreshed} recipe cost(s); ${changed.length} changed.`);
  for (const r of changed.sort((a, b) => Math.abs((b.estimatedCost ?? 0) - (before.get(b.id) ?? 0)) - Math.abs((a.estimatedCost ?? 0) - (before.get(a.id) ?? 0))).slice(0, 15)) {
    console.log(`  ${r.title} (${r.venue ?? 'shared'}): $${(before.get(r.id) ?? 0).toFixed(2)} → $${(r.estimatedCost ?? 0).toFixed(2)}`);
  }
}

async function rollback(runId: string, force: boolean) {
  const rows = await prisma.$queryRawUnsafe<Array<{ kind: string; rowId: string; payload: Record<string, unknown> }>>(`SELECT kind, "rowId", payload FROM "${TABLE}" WHERE "runId" = $1 ORDER BY id`, runId);
  if (!rows.length) throw new Error(`No record of run ${runId}`);
  if (rows.some((r) => r.kind === 'rolled_back')) throw new Error(`Run ${runId} was already rolled back.`);
  const itemIds = rows.filter((r) => r.kind === 'item').map((r) => r.rowId);
  const used = await Promise.all([
    prisma.stocktakeLine.count({ where: { itemId: { in: itemIds } } }),
    prisma.inventoryMovement.count({ where: { itemId: { in: itemIds } } }),
    prisma.recipeLine.count({ where: { itemId: { in: itemIds } } })
  ]);
  if (!force && used.some((n) => n > 0)) {
    throw new Error(`run ${runId}: the items have been used since (${used[0]} count lines, ${used[1]} movements, ${used[2]} recipe lines). Decide what to keep, then --force.`);
  }
  await prisma.$transaction(async (tx) => {
    for (const r of rows.filter((x) => x.kind === 'recipeLineDeleted')) {
      const p = r.payload as Record<string, unknown>;
      const data = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v) : v]));
      await tx.recipeLine.create({ data: data as never });
    }
    for (const r of rows.filter((x) => x.kind === 'recipe')) {
      const p = r.payload;
      await tx.recipe.update({ where: { id: r.rowId }, data: { yieldQuantity: p.yieldQuantity as number | null, yieldUnit: p.yieldUnit as string | null, portionSize: p.portionSize as number | null, portionUnit: p.portionUnit as string | null, estimatedCost: p.estimatedCost as number | null } });
      await tx.$executeRawUnsafe(`UPDATE "Recipe" SET "updatedAt" = ($1::timestamptz AT TIME ZONE 'UTC') WHERE id = $2`, p.updatedAt, r.rowId);
    }
    for (const r of rows.filter((x) => x.kind === 'recipeLine')) {
      const p = r.payload;
      await tx.recipeLine.update({ where: { id: r.rowId }, data: { ingredientName: p.ingredientName as string, quantity: p.quantity as number | null, unit: p.unit as string | null, itemId: p.itemId as string | null, subRecipeId: p.subRecipeId as string | null } });
      await tx.$executeRawUnsafe(`UPDATE "RecipeLine" SET "updatedAt" = ($1::timestamptz AT TIME ZONE 'UTC') WHERE id = $2`, p.updatedAt, r.rowId);
    }
    await tx.venueStockItem.deleteMany({ where: { stockItemId: { in: itemIds } } });
    await tx.stockItem.deleteMany({ where: { id: { in: itemIds } } });
    for (const t of rows.filter((r) => r.kind === 'template')) {
      await tx.stocktakeTemplate.update({ where: { id: t.rowId }, data: { categoryIds: t.payload.categoryIds as string[] } });
      await tx.$executeRawUnsafe(`UPDATE "StocktakeTemplate" SET "updatedAt" = ($1::timestamptz AT TIME ZONE 'UTC') WHERE id = $2`, t.payload.updatedAt, t.rowId);
    }
  });
  // Stored recipe costs follow the restored lines and yields.
  const touched = new Set<string>();
  for (const r of rows) {
    if (r.kind === 'recipe') touched.add(r.rowId);
    if (r.kind === 'recipeLine' || r.kind === 'recipeLineDeleted') touched.add(String((r.payload as Record<string, unknown>).recipeId));
  }
  const refreshed = touched.size ? await refreshRecipeCosts(Array.from(touched)) : { recipesRefreshed: 0 };
  await prisma.$executeRawUnsafe(`INSERT INTO "${TABLE}" ("runId",kind,"rowId",payload) VALUES ($1,'rolled_back',$1,'{}'::jsonb)`, runId);
  console.log(`Rolled back run ${runId}: ${itemIds.length} item(s) removed, ${rows.filter((r) => r.kind === 'template').length} template(s), ${rows.filter((r) => r.kind === 'recipeLine').length} recipe line(s), ${rows.filter((r) => r.kind === 'recipeLineDeleted').length} deleted line(s) and ${rows.filter((r) => r.kind === 'recipe').length} recipe(s) restored; ${refreshed.recipesRefreshed} recipe cost(s) refreshed.`);
}

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  const [{ db }] = await prisma.$queryRawUnsafe<Array<{ db: string }>>('SELECT current_database() AS db');
  const production = db === 'alma_suite_v18' || !/@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const writing = flag('--apply') || flag('--apply-links') || flag('--apply-recipes') || flag('--apply-prune') || flag('--apply-refresh') || option('--rollback');
  if (production && writing && !flag('--i-mean-production')) throw new Error(`Connected to ${db}. Add --i-mean-production to write to it.`);
  console.log(`database: ${db}${production ? ' — PRODUCTION' : ''}`);
  // A dry run is strictly read-only: the backup table is created only when writing.
  if (writing) await ensureTable();
  const runToRollback = option('--rollback');
  if (runToRollback) return rollback(runToRollback, flag('--force'));
  if (flag('--refresh-costs')) return refreshAllCosts();
  if (flag('--prune-leftovers')) {
    const runId = option('--run-id') ?? `prepared-prune-${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`;
    return pruneLeftovers(runId);
  }
  const recipesFile = option('--recipes');
  if (recipesFile) {
    const runId = option('--run-id') ?? `prepared-recipes-${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`;
    return applyRecipes(runId, recipesFile);
  }
  const linksFile = option('--links');
  if (linksFile) {
    const runId = option('--run-id') ?? `prepared-links-${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`;
    return applyLinks(runId, linksFile);
  }

  const rows = await plan(flag('--all'));
  for (const section of [BAR_SECTION, KITCHEN_SECTION]) {
    const mine = rows.filter((r) => r.section === section);
    console.log(`\n== ${section} (${mine.length})`);
    for (const r of mine) {
      console.log(`  ${r.name} | ${r.venue ?? 'no venue'} | counted in ${r.countUnit || '?'} | container ${r.containerSize ?? '?'} ${r.countUnit} | ${dollars(r.avgCostCents)} per ${r.countUnit || 'unit'}${r.problems.length ? `  ⚠ ${r.problems.join('; ')}` : ''}`);
    }
  }
  const skipped = rows.filter((r) => !r.countUnit || r.problems.some((p) => p.startsWith('an item called')));
  console.log(`\n${rows.length - skipped.length} ready, ${skipped.length} need attention first.`);
  if (!flag('--apply')) {
    console.log('Dry run — nothing written. Re-run with --apply (recorded for --rollback <runId>).');
    return;
  }
  const runId = option('--run-id') ?? `prepared-${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`;
  await assertFreshRun(runId);
  const created = await apply(runId, rows);
  console.log(`Applied run ${runId}: ${created} prepared-stock item(s) created. Rollback: --rollback ${runId}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
