/**
 * Set up Batch Cocktails and Kitchen Prep: one prepared-stock item for each
 * prep recipe that has been counted (or every active prep recipe with --all).
 *
 *   DATABASE_URL=… tsx scripts/create-prepared-stock-items-2026-10.ts            # dry run
 *   DATABASE_URL=… tsx scripts/create-prepared-stock-items-2026-10.ts --apply
 *   DATABASE_URL=… tsx scripts/create-prepared-stock-items-2026-10.ts --rollback <runId>
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
import { prepRecipeBatchCost } from '../src/services/recipes.service.js';

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
    if (countUnit && avgCostCents === null && !problems.some((p) => p.startsWith('recipe says'))) problems.push('no ingredient has a cost — cost per unit left blank');
    else if (countUnit && cost && cost.uncostedLines > 0) problems.push(`${cost.uncostedLines} of ${cost.totalLines} ingredients uncosted — cost is a floor`);
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
  // Problems that only mean "cost is a floor" do not block creation.
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

async function rollback(runId: string, force: boolean) {
  const rows = await prisma.$queryRawUnsafe<Array<{ kind: string; rowId: string; payload: Record<string, unknown> }>>(`SELECT kind, "rowId", payload FROM "${TABLE}" WHERE "runId" = $1 ORDER BY id`, runId);
  if (!rows.length) throw new Error(`No record of run ${runId}`);
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
    await tx.venueStockItem.deleteMany({ where: { stockItemId: { in: itemIds } } });
    await tx.stockItem.deleteMany({ where: { id: { in: itemIds } } });
    for (const t of rows.filter((r) => r.kind === 'template')) {
      await tx.stocktakeTemplate.update({ where: { id: t.rowId }, data: { categoryIds: t.payload.categoryIds as string[] } });
      await tx.$executeRawUnsafe(`UPDATE "StocktakeTemplate" SET "updatedAt" = ($1::timestamptz AT TIME ZONE 'UTC') WHERE id = $2`, t.payload.updatedAt, t.rowId);
    }
  });
  console.log(`Rolled back run ${runId}: ${itemIds.length} item(s) removed, ${rows.filter((r) => r.kind === 'template').length} template(s) restored.`);
}

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  const [{ db }] = await prisma.$queryRawUnsafe<Array<{ db: string }>>('SELECT current_database() AS db');
  const production = db === 'alma_suite_v18' || !/@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const writing = flag('--apply') || option('--rollback');
  if (production && writing && !flag('--i-mean-production')) throw new Error(`Connected to ${db}. Add --i-mean-production to write to it.`);
  console.log(`database: ${db}${production ? ' — PRODUCTION' : ''}`);
  await ensureTable();
  const runToRollback = option('--rollback');
  if (runToRollback) return rollback(runToRollback, flag('--force'));

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
  const created = await apply(runId, rows);
  console.log(`Applied run ${runId}: ${created} prepared-stock item(s) created. Rollback: --rollback ${runId}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
