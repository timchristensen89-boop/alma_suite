/**
 * The duplicate-item merge, as functions: plan (safety checks + before/after
 * holdings), apply (snapshot → pre-merge treatments → mergeItemsWithin, all in
 * one transaction) and rollback (restore every snapshotted row, newest cluster
 * first). The script merge-duplicate-items-2026-10.ts is the CLI;
 * tests/duplicate-merge.test.ts drives these against a database to prove a
 * merge can be undone exactly.
 *
 * Why the merge is wrapped rather than called as the Items page calls it:
 * itemsService.mergeItems SUMS a twin's venue holding into the survivor's and
 * FOLDS two lines on one sheet by addition. For a twin whose holding is the
 * leftover of a count the survivor has since replaced, and for a sheet where
 * the same bottles were written down twice under two names, both of those
 * double count. The decisions file says, per holding and per sheet, which it
 * is; this module applies that before the merge runs, with every changed row
 * written to _stock_merge_backup first.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import { mergeItemsWithin } from '../../src/services/items.service.js';

export type Treatment = 'keep' | 'discard_stale' | 'recount';
export type DoubleCountTreatment = 'none' | 'sum' | 'keep_canonical_line_only' | 'keep_duplicate_line' | 'recount';
export type Decision = {
  index: number;
  cluster: string;
  action: 'merge' | 'merge_partial';
  canonicalId: string;
  duplicateIds: string[];
  unitSafe: boolean;
  /** Required when a duplicate's avgCost and the survivor's differ by more than 2×. */
  costReviewed?: boolean;
  onHandPlan: Array<{ itemId: string; venue: string; treatment: Treatment; onHand?: number | null; why?: string }>;
  sameSheetDoubleCount: { present: boolean; treatment: DoubleCountTreatment; stocktakeIds?: string[]; detail?: string };
  parLevelOverride?: Record<string, number>;
  canonicalNameSuggestion?: string;
  renameCanonical?: boolean;
};

export const BACKUP_TABLE = '_stock_merge_backup';
export const REAL_VENUES = new Set(['Alma Avalon', 'St Alma']);
export const LIVE_SHEET_WINDOW_MS = 30 * 60 * 1000;
export const COST_DISAGREEMENT_LIMIT = 2;
// Every table that points at a StockItem and gets repointed by the merge.
// `hasUpdatedAt` marks the ones Prisma stamps on update, so the rollback can
// put the real timestamp back.
export const REPOINTED: Array<{ table: string; model: 'recipeLine' | 'inventoryMovement' | 'supplierInvoiceLine' | 'stockTransfer' | 'stockWastageRecord' | 'stockDeliveryCheckItem' | 'stockReorderNotice' | 'squareMenuRecipeMapping' | 'purchaseOrderLine'; column: 'itemId' | 'stockItemId'; hasUpdatedAt: boolean }> = [
  { table: 'RecipeLine', model: 'recipeLine', column: 'itemId', hasUpdatedAt: true },
  { table: 'InventoryMovement', model: 'inventoryMovement', column: 'itemId', hasUpdatedAt: false },
  { table: 'SupplierInvoiceLine', model: 'supplierInvoiceLine', column: 'itemId', hasUpdatedAt: true },
  { table: 'StockTransfer', model: 'stockTransfer', column: 'stockItemId', hasUpdatedAt: false },
  { table: 'StockWastageRecord', model: 'stockWastageRecord', column: 'stockItemId', hasUpdatedAt: true },
  { table: 'StockDeliveryCheckItem', model: 'stockDeliveryCheckItem', column: 'stockItemId', hasUpdatedAt: true },
  { table: 'StockReorderNotice', model: 'stockReorderNotice', column: 'stockItemId', hasUpdatedAt: true },
  { table: 'SquareMenuRecipeMapping', model: 'squareMenuRecipeMapping', column: 'stockItemId', hasUpdatedAt: true },
  { table: 'PurchaseOrderLine', model: 'purchaseOrderLine', column: 'stockItemId', hasUpdatedAt: false }
];

export const dollars = (cents: number | null | undefined) => `$${((cents ?? 0) / 100).toFixed(2)}`;
const lower = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();

export async function ensureBackupTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "${BACKUP_TABLE}" (
      id bigserial PRIMARY KEY,
      "runId" text NOT NULL,
      "clusterIndex" integer NOT NULL,
      step text NOT NULL,
      "tableName" text NOT NULL,
      "rowId" text NOT NULL,
      payload jsonb NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "${BACKUP_TABLE}_run_idx" ON "${BACKUP_TABLE}" ("runId", "clusterIndex")`);
}

type Tx = Prisma.TransactionClient;

async function backup(tx: Tx, runId: string, clusterIndex: number, step: string, tableName: string, rows: Array<Record<string, unknown>>) {
  for (const row of rows) {
    await tx.$executeRawUnsafe(
      `INSERT INTO "${BACKUP_TABLE}" ("runId","clusterIndex",step,"tableName","rowId",payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      runId, clusterIndex, step, tableName, String(row.id), JSON.stringify(row)
    );
  }
}

/**
 * Sheets whose lines are repointed but never folded: anything not at a real
 * venue (the stray venue-less count, the phantom "Avalon" count — both list
 * every item, so parent and duplicate each have a line) and anything still
 * open for counting. A double count on a finalised real-venue sheet is handled
 * explicitly by the decision's sameSheetDoubleCount instead.
 */
export async function foldExcludedSheetIds(tx: Tx): Promise<string[]> {
  const rows = await tx.stocktake.findMany({
    where: { OR: [{ venue: null }, { venue: { notIn: Array.from(REAL_VENUES) } }, { status: { in: ['IN_PROGRESS', 'REOPENED'] } }] },
    select: { id: true }
  });
  return rows.map((row) => row.id);
}

export type Snapshot = {
  items: Array<Record<string, unknown>>;
  venueStock: Array<Record<string, unknown>>;
  dupLines: Array<Record<string, unknown>>;
  parentLines: Array<Record<string, unknown>>;
  movementsByLine: Array<{ id: string; sourceStocktakeLineId: string | null }>;
  refs: Record<string, Array<{ id: string; itemId: string; updatedAt?: string | Date | null }>>;
  aliases: Array<Record<string, unknown>>;
  priceLists: Array<Record<string, unknown>>;
};

export async function takeSnapshot(tx: Tx, d: Decision): Promise<Snapshot> {
  const memberIds = [d.canonicalId, ...d.duplicateIds];
  const items = await tx.stockItem.findMany({ where: { id: { in: memberIds } } });
  const venueStock = await tx.venueStockItem.findMany({ where: { stockItemId: { in: memberIds } } });
  const dupLines = await tx.stocktakeLine.findMany({ where: { itemId: { in: d.duplicateIds } } });
  const stocktakeIds = [...new Set(dupLines.map((line) => line.stocktakeId))];
  const parentLines = stocktakeIds.length ? await tx.stocktakeLine.findMany({ where: { itemId: d.canonicalId, stocktakeId: { in: stocktakeIds } } }) : [];
  const movementsByLine = dupLines.length
    ? await tx.inventoryMovement.findMany({ where: { sourceStocktakeLineId: { in: dupLines.map((line) => line.id) } }, select: { id: true, sourceStocktakeLineId: true } })
    : [];
  const refs: Snapshot['refs'] = {};
  for (const ref of REPOINTED) {
    const rows = await (tx[ref.model] as unknown as { findMany: (args: unknown) => Promise<Array<Record<string, string | Date | null>>> }).findMany({
      where: { [ref.column]: { in: d.duplicateIds } },
      select: { id: true, [ref.column]: true, ...(ref.hasUpdatedAt ? { updatedAt: true } : {}) }
    });
    refs[ref.table] = rows.map((row) => ({ id: row.id as string, itemId: row[ref.column] as string, ...(ref.hasUpdatedAt ? { updatedAt: row.updatedAt } : {}) }));
  }
  const aliases = await tx.stockItemAlias.findMany({ where: { stockItemId: { in: memberIds } } });
  const priceLists = await tx.supplierPriceListItem.findMany({ where: { stockItemId: { in: memberIds } } });
  return { items: items as never, venueStock: venueStock as never, dupLines: dupLines as never, parentLines: parentLines as never, movementsByLine, refs, aliases: aliases as never, priceLists: priceLists as never };
}

export async function writeSnapshot(tx: Tx, runId: string, d: Decision, snap: Snapshot) {
  await backup(tx, runId, d.index, 'pre', 'StockItem', snap.items);
  await backup(tx, runId, d.index, 'pre', 'VenueStockItem', snap.venueStock);
  await backup(tx, runId, d.index, 'pre', 'StocktakeLine', [...snap.dupLines, ...snap.parentLines]);
  await backup(tx, runId, d.index, 'pre', 'InventoryMovement.sourceStocktakeLineId', snap.movementsByLine.map((m) => ({ id: m.id, sourceStocktakeLineId: m.sourceStocktakeLineId })));
  for (const [table, rows] of Object.entries(snap.refs)) await backup(tx, runId, d.index, 'pre', `${table}.ref`, rows);
  await backup(tx, runId, d.index, 'pre', 'stock_item_aliases', snap.aliases);
  await backup(tx, runId, d.index, 'pre', 'SupplierPriceListItem', snap.priceLists);
  await backup(tx, runId, d.index, 'pre', 'decision', [{ id: String(d.index), ...d } as Record<string, unknown>]);
}

export type Check = { ok: boolean; problems: string[]; warnings: string[] };

/** Run-level refusals: the same item in two clusters would be merged twice. */
export function checkRun(decisions: Decision[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, number>();
  for (const d of decisions) {
    for (const id of [d.canonicalId, ...d.duplicateIds]) {
      const other = seen.get(id);
      if (other !== undefined && other !== d.index) problems.push(`${id} is in clusters #${other} and #${d.index} — leave exactly one`);
      seen.set(id, d.index);
    }
  }
  return problems;
}

/** Sheets where more than one member has a counted line — the double-count candidates. */
async function doubleCountSheets(client: Tx | typeof prisma, d: Decision, excluded: Set<string>) {
  const lines = await client.stocktakeLine.findMany({
    where: { itemId: { in: [d.canonicalId, ...d.duplicateIds] }, countedQty: { not: null } },
    select: { id: true, itemId: true, stocktakeId: true, countedQty: true, unit: true, stockValueCents: true, notes: true, location: true, position: true, stocktake: { select: { id: true, name: true, status: true, appliedAt: true } } }
  });
  const bySheet = new Map<string, typeof lines>();
  for (const line of lines) {
    if (excluded.has(line.stocktakeId)) continue;
    const list = bySheet.get(line.stocktakeId) ?? [];
    list.push(line);
    bySheet.set(line.stocktakeId, list);
  }
  const limitTo = d.sameSheetDoubleCount.stocktakeIds?.length ? new Set(d.sameSheetDoubleCount.stocktakeIds) : null;
  return [...bySheet.entries()]
    .filter(([sheetId, list]) => new Set(list.map((l) => l.itemId)).size > 1 && (!limitTo || limitTo.has(sheetId)))
    .map(([sheetId, list]) => ({
      sheetId,
      sheet: list[0]!.stocktake,
      parentLines: list.filter((l) => l.itemId === d.canonicalId).sort((a, b) => a.position - b.position),
      dupLines: list.filter((l) => l.itemId !== d.canonicalId)
    }));
}

export async function checkCluster(d: Decision): Promise<Check> {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (d.action !== 'merge' && d.action !== 'merge_partial') problems.push(`action ${d.action} is not a merge`);
  if (!d.duplicateIds.length) problems.push('no duplicates listed');
  if (d.duplicateIds.includes(d.canonicalId)) problems.push('canonical listed as its own duplicate');
  const memberIds = [d.canonicalId, ...d.duplicateIds];
  const items = await prisma.stockItem.findMany({ where: { id: { in: memberIds } }, include: { category: true, venueStock: true } });
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const id of memberIds) {
    const item = byId.get(id);
    if (!item) problems.push(`${id} not found`);
    else if (item.status !== 'ACTIVE') problems.push(`${item.name} is ${item.status} (already merged or archived?)`);
    else if (item.notes?.includes('Merged into "')) problems.push(`${item.name} carries a merge note already`);
  }
  const canonical = byId.get(d.canonicalId);
  const dups = d.duplicateIds.map((id) => byId.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (canonical) {
    const categoryAfter = canonical.categoryId ?? dups.find((dup) => dup.categoryId)?.categoryId ?? null;
    if (!categoryAfter) problems.push('survivor would have no category');
    const countUnitAfter = canonical.countUnit ?? dups.find((dup) => dup.countUnit)?.countUnit ?? canonical.unit;
    if (!countUnitAfter) problems.push('survivor would have no count unit');
    for (const dup of dups) {
      const a = lower(canonical.countUnit ?? canonical.unit);
      const b = lower(dup.countUnit ?? dup.unit);
      if (a !== b && !d.unitSafe) problems.push(`count unit differs: ${canonical.name} (${a}) vs ${dup.name} (${b}) and the decision is not marked unitSafe`);
      else if (a !== b) warnings.push(`count unit differs (${a} vs ${b}) — decision says unitSafe`);
      if (canonical.measurePerCountUnit && dup.measurePerCountUnit && canonical.measurePerCountUnit !== dup.measurePerCountUnit) {
        warnings.push(`measure per count unit differs (${canonical.measurePerCountUnit} vs ${dup.measurePerCountUnit} ${dup.measureUnit ?? ''}) — recipe lines in g/mL will cost off the survivor's`);
      }
      if (canonical.conversionFactor !== 1 && dup.conversionFactor !== 1 && canonical.conversionFactor !== dup.conversionFactor) {
        warnings.push(`pack factor differs (${canonical.conversionFactor} vs ${dup.conversionFactor}); the survivor's is kept`);
      }
      if (canonical.avgCostCents && dup.avgCostCents) {
        const ratio = Math.max(canonical.avgCostCents, dup.avgCostCents) / Math.min(canonical.avgCostCents, dup.avgCostCents);
        if (ratio > COST_DISAGREEMENT_LIMIT && !d.costReviewed) problems.push(`avg cost differs ${ratio.toFixed(1)}× (${dollars(canonical.avgCostCents)} vs ${dollars(dup.avgCostCents)}) — set costReviewed once the right cost is on the survivor`);
        else if (ratio > COST_DISAGREEMENT_LIMIT) warnings.push(`avg cost differs ${ratio.toFixed(1)}× — reviewed`);
      }
    }
    const planned = new Map(d.onHandPlan.map((p) => [`${p.itemId}|${p.venue}`, p]));
    for (const item of items) {
      for (const vs of item.venueStock) {
        if (!REAL_VENUES.has(vs.venue)) continue;
        const plan = planned.get(`${item.id}|${vs.venue}`);
        if ((vs.onHand ?? 0) !== 0 && !plan) problems.push(`no on-hand treatment for ${item.name} @ ${vs.venue} (onHand ${vs.onHand})`);
        if (plan?.treatment === 'discard_stale' && plan.onHand != null && Math.abs((vs.onHand ?? 0) - plan.onHand) > 0.005) {
          problems.push(`${item.name} @ ${vs.venue} on hand is ${vs.onHand}, the review saw ${plan.onHand} — counted since; re-review`);
        }
        // A holding nothing on the latest sheet accounts for is carried
        // across unchanged and listed for the next count; it is not a
        // reason to leave the duplicate in place.
        if (plan?.treatment === 'recount') warnings.push(`recount ${item.name} @ ${vs.venue} (${vs.onHand}) at the next count — carried across as is`);
      }
    }
    // One recipe fed by two members ends up with two lines for one item.
    const sharedRecipes = await prisma.recipeLine.groupBy({ by: ['recipeId'], where: { itemId: { in: memberIds } }, _count: { _all: true }, having: { recipeId: { _count: { gt: 1 } } } });
    for (const r of sharedRecipes) {
      const distinct = await prisma.recipeLine.findMany({ where: { recipeId: r.recipeId, itemId: { in: memberIds } }, select: { itemId: true } });
      if (new Set(distinct.map((l) => l.itemId)).size > 1) warnings.push(`recipe ${r.recipeId} is fed by two members — it will cost the item twice until its lines are collapsed by hand`);
    }
  }
  // Sheets: never merge under someone's feet, never fold where apply would read a different line.
  const excluded = new Set(await foldExcludedSheetIds(prisma));
  const memberLines = await prisma.stocktakeLine.findMany({ where: { itemId: { in: memberIds } }, select: { stocktakeId: true } });
  const stocktakeIds = [...new Set(memberLines.map((line) => line.stocktakeId))];
  if (stocktakeIds.length) {
    const live = await prisma.stocktake.findMany({ where: { id: { in: stocktakeIds }, status: { in: ['IN_PROGRESS', 'REOPENED', 'SUBMITTED'] }, updatedAt: { gte: new Date(Date.now() - LIVE_SHEET_WINDOW_MS) } }, select: { name: true } });
    for (const s of live) problems.push(`"${s.name}" was saved in the last 30 minutes — someone may be counting; wait`);
  }
  const doubles = await doubleCountSheets(prisma, d, excluded);
  if (doubles.length && d.sameSheetDoubleCount.treatment === 'none') problems.push(`counted on the same sheet as the survivor (${doubles.map((x) => x.sheet.name).join(', ')}) but the decision says no double count`);
  if (doubles.length && d.sameSheetDoubleCount.treatment === 'recount') problems.push('double count marked recount — needs a human before merging');
  for (const x of doubles) {
    if (x.parentLines.length > 1 && !x.sheet.appliedAt) problems.push(`"${x.sheet.name}" already has ${x.parentLines.length} lines for the survivor; the fold would land on one apply ignores`);
    if (d.sameSheetDoubleCount.treatment === 'keep_duplicate_line' && x.dupLines.length !== 1) problems.push(`"${x.sheet.name}": keep_duplicate_line needs exactly one duplicate line, found ${x.dupLines.length}`);
  }
  return { ok: problems.length === 0, problems, warnings };
}

export type Plan = {
  d: Decision;
  check: Check;
  holdingsBefore: Record<string, { onHand: number; valueCents: number }>;
  holdingsAfter: Record<string, { onHand: number; valueCents: number }>;
  discarded: Array<{ item: string; venue: string; onHand: number; valueCents: number }>;
  recount: Array<{ item: string; venue: string; onHand: number; valueCents: number }>;
  doubleCounts: Array<{ sheet: string; sheetId: string; treatment: DoubleCountTreatment; parentQty: number | null; dupQty: number | null; dupValueCents: number | null }>;
  foldExcluded: number;
  refCounts: Record<string, number>;
  names: { canonical: string; duplicates: string[] };
};

export async function planCluster(d: Decision): Promise<Plan> {
  const check = await checkCluster(d);
  const memberIds = [d.canonicalId, ...d.duplicateIds];
  const items = await prisma.stockItem.findMany({ where: { id: { in: memberIds } }, include: { venueStock: true } });
  const byId = new Map(items.map((item) => [item.id, item]));
  const canonical = byId.get(d.canonicalId);
  const costOf = (itemId: string) => byId.get(itemId)?.avgCostCents ?? canonical?.avgCostCents ?? 0;
  const holdingsBefore: Plan['holdingsBefore'] = {};
  const holdingsAfter: Plan['holdingsAfter'] = {};
  const discarded: Plan['discarded'] = [];
  const recount: Plan['recount'] = [];
  for (const item of items) {
    for (const vs of item.venueStock) {
      if (!REAL_VENUES.has(vs.venue)) continue;
      const onHand = vs.onHand ?? 0;
      const valueCents = Math.round(onHand * costOf(item.id));
      holdingsBefore[vs.venue] = { onHand: (holdingsBefore[vs.venue]?.onHand ?? 0) + onHand, valueCents: (holdingsBefore[vs.venue]?.valueCents ?? 0) + valueCents };
      const treatment = d.onHandPlan.find((p) => p.itemId === item.id && p.venue === vs.venue)?.treatment ?? 'keep';
      if (treatment === 'recount') recount.push({ item: item.name, venue: vs.venue, onHand, valueCents });
      if (treatment === 'discard_stale' && onHand !== 0) {
        discarded.push({ item: item.name, venue: vs.venue, onHand, valueCents });
      } else {
        const after = holdingsAfter[vs.venue] ?? { onHand: 0, valueCents: 0 };
        holdingsAfter[vs.venue] = { onHand: after.onHand + onHand, valueCents: after.valueCents + Math.round(onHand * (canonical?.avgCostCents ?? costOf(item.id))) };
      }
    }
  }
  const excluded = new Set(await foldExcludedSheetIds(prisma));
  const doubles = await doubleCountSheets(prisma, d, excluded);
  const doubleCounts: Plan['doubleCounts'] = doubles.map((x) => ({
    sheet: x.sheet.name, sheetId: x.sheetId, treatment: d.sameSheetDoubleCount.treatment,
    parentQty: x.parentLines[0]?.countedQty ?? null, dupQty: x.dupLines.reduce((sum, l) => sum + (l.countedQty ?? 0), 0), dupValueCents: x.dupLines.reduce((sum, l) => sum + (l.stockValueCents ?? 0), 0)
  }));
  const foldExcluded = await prisma.stocktakeLine.count({ where: { itemId: { in: d.duplicateIds }, stocktakeId: { in: Array.from(excluded) } } });
  const refCounts: Record<string, number> = {};
  for (const ref of REPOINTED) {
    refCounts[ref.table] = await (prisma[ref.model] as unknown as { count: (args: unknown) => Promise<number> }).count({ where: { [ref.column]: { in: d.duplicateIds } } });
  }
  refCounts.StocktakeLine = await prisma.stocktakeLine.count({ where: { itemId: { in: d.duplicateIds } } });
  refCounts.aliases = await prisma.stockItemAlias.count({ where: { stockItemId: { in: d.duplicateIds } } });
  return {
    d, check, holdingsBefore, holdingsAfter, discarded, recount, doubleCounts, foldExcluded, refCounts,
    names: { canonical: canonical?.name ?? d.canonicalId, duplicates: d.duplicateIds.map((id) => byId.get(id)?.name ?? id) }
  };
}

export function printPlan(plan: Plan, apply: boolean) {
  const { d } = plan;
  console.log(`\n#${d.index} ${d.cluster} — ${plan.check.ok ? (apply ? 'MERGE' : 'plan') : 'REFUSED'}`);
  console.log(`  survivor:   ${plan.names.canonical} (${d.canonicalId})`);
  for (const [i, name] of plan.names.duplicates.entries()) console.log(`  duplicate:  ${name} (${d.duplicateIds[i]})`);
  for (const venue of Object.keys({ ...plan.holdingsBefore, ...plan.holdingsAfter }).sort()) {
    const b = plan.holdingsBefore[venue] ?? { onHand: 0, valueCents: 0 };
    const a = plan.holdingsAfter[venue] ?? { onHand: 0, valueCents: 0 };
    console.log(`  ${venue.padEnd(12)} on hand ${b.onHand} → ${a.onHand}   value ${dollars(b.valueCents)} → ${dollars(a.valueCents)}`);
  }
  for (const x of plan.discarded) console.log(`  discard stale: ${x.item} @ ${x.venue}: ${x.onHand} (${dollars(x.valueCents)})`);
  for (const x of plan.recount) console.log(`  recount next count: ${x.item} @ ${x.venue}: ${x.onHand} (${dollars(x.valueCents)}) — carried across as is`);
  for (const x of plan.doubleCounts) console.log(`  double count on "${x.sheet}": survivor ${x.parentQty ?? '—'}, duplicate ${x.dupQty} (${dollars(x.dupValueCents)}) → ${x.treatment}`);
  if (plan.foldExcluded) console.log(`  ${plan.foldExcluded} line${plan.foldExcluded === 1 ? '' : 's'} on venue-less / phantom / open sheets repointed only, never folded`);
  const refs = Object.entries(plan.refCounts).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(', ');
  console.log(`  moves: ${refs || 'nothing referenced'}`);
  for (const w of plan.check.warnings) console.log(`  warn: ${w}`);
  for (const p of plan.check.problems) console.log(`  REFUSED: ${p}`);
}

export async function applyCluster(runId: string, plan: Plan) {
  const { d } = plan;
  return prisma.$transaction(async (tx) => {
    // Hold the touched sheets so a count being saved waits for the merge
    // rather than interleaving with it.
    const memberIds = [d.canonicalId, ...d.duplicateIds];
    const sheetIds = (await tx.stocktakeLine.findMany({ where: { itemId: { in: memberIds } }, select: { stocktakeId: true }, distinct: ['stocktakeId'] })).map((l) => l.stocktakeId);
    if (sheetIds.length) await tx.$queryRawUnsafe(`SELECT id FROM "Stocktake" WHERE id = ANY($1::text[]) FOR UPDATE`, sheetIds);
    await tx.$queryRawUnsafe(`SELECT id FROM "StockItem" WHERE id = ANY($1::text[]) FOR UPDATE`, memberIds);

    const snap = await takeSnapshot(tx, d);
    await writeSnapshot(tx, runId, d, snap);

    for (const x of d.onHandPlan) {
      if (x.treatment !== 'discard_stale') continue;
      await tx.venueStockItem.updateMany({ where: { stockItemId: x.itemId, venue: x.venue }, data: { onHand: 0 } });
    }

    const excluded = new Set(await foldExcludedSheetIds(tx));
    const treatment = d.sameSheetDoubleCount.treatment;
    if (treatment === 'keep_canonical_line_only' || treatment === 'keep_duplicate_line') {
      for (const x of await doubleCountSheets(tx, d, excluded)) {
        const parent = x.parentLines[0];
        if (!parent) continue;
        if (treatment === 'keep_duplicate_line') {
          const dup = x.dupLines[0]!;
          await tx.stocktakeLine.update({ where: { id: parent.id }, data: { countedQty: dup.countedQty, stockValueCents: dup.stockValueCents, notes: dup.notes, location: dup.location } });
        }
        for (const dup of x.dupLines) {
          await tx.inventoryMovement.updateMany({ where: { sourceStocktakeLineId: dup.id }, data: { sourceStocktakeLineId: parent.id } });
          await tx.stocktakeLine.delete({ where: { id: dup.id } });
        }
      }
    }

    const result = await mergeItemsWithin(tx, { parentId: d.canonicalId, duplicateIds: d.duplicateIds, actorName: `merge-duplicate-items-2026-10 run ${runId}`, foldExcludeStocktakeIds: Array.from(excluded) });

    if (d.parLevelOverride) {
      for (const [venue, parLevel] of Object.entries(d.parLevelOverride)) {
        await tx.venueStockItem.updateMany({ where: { stockItemId: d.canonicalId, venue }, data: { parLevel } });
      }
    }
    if (d.renameCanonical && d.canonicalNameSuggestion?.trim()) {
      await tx.stockItem.update({ where: { id: d.canonicalId }, data: { name: d.canonicalNameSuggestion.trim() } });
    }
    await tx.$executeRawUnsafe(
      `INSERT INTO "${BACKUP_TABLE}" ("runId","clusterIndex",step,"tableName","rowId",payload) VALUES ($1,$2,'result','merge',$3,$4::jsonb)`,
      runId, d.index, d.canonicalId, JSON.stringify(result)
    );
    return result;
  }, { maxWait: 15_000, timeout: 120_000 });
}

async function restoreUpdatedAt(tx: Tx, table: string, rows: Array<Record<string, unknown>>) {
  for (const row of rows) {
    if (!row.updatedAt) continue;
    // Columns are `timestamp without time zone` holding UTC wall-clock time;
    // cast via UTC explicitly so the session time zone cannot shift them.
    await tx.$executeRawUnsafe(`UPDATE "${table}" SET "updatedAt" = ($1::timestamptz AT TIME ZONE 'UTC') WHERE id = $2`, row.updatedAt, row.id);
  }
}

export async function rollback(runId: string, options: { force?: boolean } = {}) {
  const rows = await prisma.$queryRawUnsafe<Array<{ clusterIndex: number; step: string; tableName: string; rowId: string; payload: Record<string, unknown>; createdAt: Date }>>(
    `SELECT "clusterIndex", step, "tableName", "rowId", payload, "createdAt" FROM "${BACKUP_TABLE}" WHERE "runId" = $1 ORDER BY "clusterIndex" DESC, id ASC`, runId
  );
  if (!rows.length) throw new Error(`No snapshot for run ${runId}`);
  const clusters = [...new Set(rows.map((r) => r.clusterIndex))];
  for (const clusterIndex of clusters) {
    const mine = rows.filter((r) => r.clusterIndex === clusterIndex);
    if (mine.some((r) => r.step === 'rolled_back')) {
      console.log(`cluster #${clusterIndex} already rolled back`);
      continue;
    }
    const of = (table: string) => mine.filter((r) => r.step === 'pre' && r.tableName === table).map((r) => r.payload);
    const decision = of('decision')[0] as unknown as Decision | undefined;
    if (!decision) throw new Error(`cluster ${clusterIndex}: no decision in snapshot`);
    const merged = mine.find((r) => r.step === 'result');
    const memberIds = [decision.canonicalId, ...decision.duplicateIds];

    // Anything written against the survivor since the merge belongs to a
    // human decision, not a restore.
    if (merged && !options.force) {
      const since = merged.createdAt;
      const later = await Promise.all([
        prisma.stocktakeLine.count({ where: { itemId: decision.canonicalId, createdAt: { gt: since } } }),
        prisma.inventoryMovement.count({ where: { itemId: decision.canonicalId, createdAt: { gt: since } } }),
        prisma.recipeLine.count({ where: { itemId: decision.canonicalId, createdAt: { gt: since } } }),
        prisma.supplierInvoiceLine.count({ where: { itemId: decision.canonicalId, createdAt: { gt: since } } })
      ]);
      if (later.some((n) => n > 0)) {
        throw new Error(`cluster #${clusterIndex}: ${later[0]} stocktake lines, ${later[1]} movements, ${later[2]} recipe lines, ${later[3]} invoice lines were created on the survivor after the merge — decide where they belong, then --force`);
      }
    }

    console.log(`restoring cluster #${clusterIndex} ${decision.cluster}`);
    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM "StockItem" WHERE id = ANY($1::text[]) FOR UPDATE`, memberIds);
      // Free the unique sku before restoring rows that may swap it.
      await tx.stockItem.updateMany({ where: { id: { in: memberIds } }, data: { sku: null } });
      const itemRows = of('StockItem');
      for (const item of itemRows) {
        const { id, ...data } = item as { id: string } & Record<string, unknown>;
        await tx.stockItem.update({ where: { id }, data: data as Prisma.StockItemUncheckedUpdateInput });
      }
      await tx.venueStockItem.deleteMany({ where: { stockItemId: { in: memberIds } } });
      const venueRows = of('VenueStockItem');
      for (const vs of venueRows) await tx.venueStockItem.create({ data: vs as unknown as Prisma.VenueStockItemUncheckedCreateInput });
      const lineRows = of('StocktakeLine');
      for (const line of lineRows) {
        const { id, ...data } = line as { id: string } & Record<string, unknown>;
        const exists = await tx.stocktakeLine.findUnique({ where: { id }, select: { id: true } });
        if (exists) await tx.stocktakeLine.update({ where: { id }, data: data as Prisma.StocktakeLineUncheckedUpdateInput });
        else await tx.stocktakeLine.create({ data: line as unknown as Prisma.StocktakeLineUncheckedCreateInput });
      }
      for (const m of of('InventoryMovement.sourceStocktakeLineId')) {
        await tx.inventoryMovement.update({ where: { id: m.id as string }, data: { sourceStocktakeLineId: (m.sourceStocktakeLineId as string | null) ?? null } });
      }
      for (const ref of REPOINTED) {
        const refRows = of(`${ref.table}.ref`);
        for (const row of refRows) {
          await (tx[ref.model] as unknown as { update: (args: unknown) => Promise<unknown> }).update({ where: { id: row.id }, data: { [ref.column]: row.itemId } });
        }
        if (ref.hasUpdatedAt) await restoreUpdatedAt(tx, ref.table, refRows);
      }
      await tx.stockItemAlias.deleteMany({ where: { stockItemId: { in: memberIds } } });
      const aliasRows = of('stock_item_aliases');
      for (const alias of aliasRows) await tx.stockItemAlias.create({ data: alias as unknown as Prisma.StockItemAliasUncheckedCreateInput });
      await tx.supplierPriceListItem.deleteMany({ where: { stockItemId: { in: memberIds } } });
      const priceRows = of('SupplierPriceListItem');
      for (const row of priceRows) await tx.supplierPriceListItem.create({ data: row as unknown as Prisma.SupplierPriceListItemUncheckedCreateInput });
      // Prisma bumps @updatedAt on every write above; put the real timestamps back.
      await restoreUpdatedAt(tx, 'StockItem', itemRows);
      await restoreUpdatedAt(tx, 'VenueStockItem', venueRows);
      await restoreUpdatedAt(tx, 'StocktakeLine', lineRows);
      await restoreUpdatedAt(tx, 'stock_item_aliases', aliasRows);
      await restoreUpdatedAt(tx, 'SupplierPriceListItem', priceRows);
      await tx.$executeRawUnsafe(`INSERT INTO "${BACKUP_TABLE}" ("runId","clusterIndex",step,"tableName","rowId",payload) VALUES ($1,$2,'rolled_back','merge',$3,'{}'::jsonb)`, runId, clusterIndex, decision.canonicalId);
    }, { maxWait: 15_000, timeout: 120_000 });
  }
  console.log(`Rolled back ${clusters.length} cluster${clusters.length === 1 ? '' : 's'} of run ${runId}.`);
}

export type VerifyReport = { duplicateLinePairs: number; orphanedAnchors: number; danglingRefs: Record<string, number>; venueValueCents: Record<string, number> };

export async function verify(): Promise<VerifyReport> {
  const twoLines = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM (SELECT 1 FROM "StocktakeLine" WHERE "itemId" IS NOT NULL GROUP BY "stocktakeId", "itemId" HAVING count(*) > 1) t`
  );
  const orphans = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "InventoryMovement" WHERE "sourceStocktakeLineId" IS NULL AND "sourceStocktakeId" IS NOT NULL`);
  const dangling: Record<string, number> = {};
  for (const ref of REPOINTED) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM "${ref.table}" l JOIN "StockItem" i ON i.id = l."${ref.column}" WHERE i.status = 'ARCHIVED' AND i.notes LIKE '%merge-duplicate-items-2026-10%'`
    );
    dangling[ref.table] = rows[0]?.n ?? 0;
  }
  const lines = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "StocktakeLine" l JOIN "StockItem" i ON i.id = l."itemId" WHERE i.status = 'ARCHIVED' AND i.notes LIKE '%merge-duplicate-items-2026-10%'`);
  dangling.StocktakeLine = lines[0]?.n ?? 0;
  const venues = await prisma.$queryRawUnsafe<Array<{ venue: string; value: bigint }>>(
    `SELECT v.venue, round(sum(coalesce(v."onHand",0) * coalesce(i."avgCostCents",0)))::bigint AS value FROM "VenueStockItem" v JOIN "StockItem" i ON i.id = v."stockItemId" WHERE i.status = 'ACTIVE' AND v.venue IN ('Alma Avalon','St Alma') GROUP BY 1 ORDER BY 1`
  );
  const report: VerifyReport = {
    duplicateLinePairs: twoLines[0]?.n ?? 0,
    orphanedAnchors: orphans[0]?.n ?? 0,
    danglingRefs: dangling,
    venueValueCents: Object.fromEntries(venues.map((v) => [v.venue, Number(v.value)]))
  };
  console.log(`\nverify: stocktakes with two lines for one item: ${report.duplicateLinePairs}; orphaned ledger anchors: ${report.orphanedAnchors}; rows still on archived duplicates: ${Object.values(dangling).reduce((a, b) => a + b, 0)}`);
  for (const [venue, cents] of Object.entries(report.venueValueCents)) console.log(`  ${venue}: active stock value ${dollars(cents)}`);
  return report;
}
