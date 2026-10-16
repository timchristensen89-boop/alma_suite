/**
 * Restating quantities that were typed in the wrong unit, as functions: plan
 * (every target checked against what the reviewer saw), apply (snapshot, then
 * one transaction) and rollback (restore every snapshotted row, delete every
 * movement the run created). fix-unit-entries-2026-10.ts is the CLI;
 * tests/unit-fix.test.ts proves an apply can be undone exactly.
 *
 * Why this is needed: applyStocktake writes a line's countedQty straight into
 * the venue's on-hand and never converts the line's unit. A line of "19400 mL"
 * on an item counted in bottles became 19 400 bottles. The line's own value was
 * right (valuation does convert), so the sheet looked fine; the holding it
 * produced did not. Three things are fixed here, each listed in the reviewed
 * file docs/stock-duplicate-resolution-2026-10/unit-fixes.json:
 *
 *  - measures: what one count unit of an item really holds, where the item
 *    carries a placeholder (a floor-wave kitchen item costed per kilo but
 *    measured as 100 g). Recipe costing and every later conversion read it.
 *  - lines: counted lines on the two unapplied 1 October sheets, restated in
 *    the item's count unit (or cleared for a recount where the number cannot be
 *    trusted), so applying the sheet writes the right on-hand.
 *  - holdings: on-hand values already written from such a line, corrected with
 *    a STOCKTAKE_CORRECTION movement against the line that wrote them — the
 *    same record the app's own correction flow leaves. History is not edited.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import { setActiveUnitAliases, convertQuantityToCostUnit, normaliseUnitLabel } from '@alma/shared';

export type Confidence = 'high' | 'medium' | 'low';
export type MeasureFix = {
  /** Absent means high. A measure that only a medium/low line depends on waits with that line. */
  confidence?: Confidence;
  itemId: string;
  item: string;
  from: { measurePerCountUnit: number | null; measureUnit: string | null };
  to: { measurePerCountUnit: number; measureUnit: string };
  reason: string;
};
export type LineFix = {
  action: 'restate' | 'recount' | 'relabel';
  confidence: Confidence;
  venue: string;
  item: string;
  itemId: string;
  lineId: string;
  from: { countedQty: number; unit: string | null };
  to: { countedQty: number | null; unit: string };
  reason: string;
};
export type HoldingFix = {
  confidence: Confidence;
  venue: string;
  item: string;
  itemId: string;
  holdingId: string;
  from: { onHand: number };
  to: { onHand: number };
  sourceStocktakeId: string;
  sourceStocktakeLineId: string;
  sourceMovementId: string;
  sourceLine: { countedQty: number; unit: string | null };
  reason: string;
};
/**
 * A per-count-unit cost that holds a case or drum price (a 6-bottle case
 * price on a bottle item, a 20 L drum price on a litre item). Only the
 * average cost changes: the latest purchase price, every stocktake line's
 * stored value and every movement stay as they were, so history reads as it
 * was recorded and only today's valuation is corrected.
 */
export type CostFix = {
  confidence?: Confidence;
  itemId: string;
  item: string;
  from: { avgCostCents: number };
  to: { avgCostCents: number };
  reason: string;
};
export type UnitFixFile = {
  sheets?: Record<string, string>;
  measures?: MeasureFix[];
  lines?: LineFix[];
  holdings?: HoldingFix[];
  costs?: CostFix[];
};

const REAL_VENUES = ['Alma Avalon', 'St Alma'];
export const UNIT_FIX_BACKUP_TABLE = '_stock_unit_fix_backup';
const EPSILON = 1e-6;
const same = (a: number | null | undefined, b: number | null | undefined) =>
  a === null || a === undefined || b === null || b === undefined ? a === b : Math.abs(a - b) < EPSILON;
export const dollars = (cents: number | null | undefined) => `$${((cents ?? 0) / 100).toFixed(2)}`;

type Tx = Prisma.TransactionClient;

export async function loadUnitAliases() {
  const rows = await prisma.stockUnitAlias.findMany({ select: { alias: true, canonical: true } });
  setActiveUnitAliases(rows.length ? Object.fromEntries(rows.map((row) => [row.alias, row.canonical])) : null);
}

export async function ensureUnitFixBackupTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "${UNIT_FIX_BACKUP_TABLE}" (
      id bigserial PRIMARY KEY,
      "runId" text NOT NULL,
      step text NOT NULL,
      "tableName" text NOT NULL,
      "rowId" text NOT NULL,
      payload jsonb NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "${UNIT_FIX_BACKUP_TABLE}_run_idx" ON "${UNIT_FIX_BACKUP_TABLE}" ("runId")`);
}

async function backup(tx: Tx, runId: string, step: string, tableName: string, rows: Array<Record<string, unknown>>) {
  for (const row of rows) {
    await tx.$executeRawUnsafe(
      `INSERT INTO "${UNIT_FIX_BACKUP_TABLE}" ("runId",step,"tableName","rowId",payload) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      runId, step, tableName, String(row.id), JSON.stringify(row)
    );
  }
}

export type PlannedLine = LineFix & { sheetName: string; valueBeforeCents: number | null; valueAfterCents: number | null; rawApplyCents: number };
export type PlannedHolding = HoldingFix & { valueBeforeCents: number; valueAfterCents: number; recipeLines?: number };
export type PlannedMeasure = MeasureFix & { metricRecipeLines: number };
export type PlannedCost = CostFix & { holdings: Array<{ venue: string; onHand: number; beforeCents: number; afterCents: number }> };
export type UnitFixPlan = {
  costs: PlannedCost[];
  measures: PlannedMeasure[];
  lines: PlannedLine[];
  holdings: PlannedHolding[];
  refusals: string[];
};

/**
 * Check every target against the database. A target that no longer looks the
 * way the reviewer saw it — a line someone has since edited, a sheet that has
 * been applied, a holding a later count has moved — is a refusal: the whole
 * run stops, because the reviewed number may no longer be the right one.
 */
export async function planUnitFix(file: UnitFixFile, options: { confidence?: Confidence[] } = {}): Promise<UnitFixPlan> {
  const allowed = new Set(options.confidence ?? ['high', 'medium', 'low']);
  const refusals: string[] = [];
  const measures: PlannedMeasure[] = [];
  const lines: PlannedLine[] = [];
  const holdings: PlannedHolding[] = [];
  const costs: PlannedCost[] = [];

  for (const fix of file.costs ?? []) {
    if (!allowed.has(fix.confidence ?? 'high')) continue;
    const item = await prisma.stockItem.findUnique({ where: { id: fix.itemId }, include: { venueStock: true } });
    if (!item) { refusals.push(`cost ${fix.item}: item ${fix.itemId} not found`); continue; }
    if (item.avgCostCents !== fix.from.avgCostCents) {
      refusals.push(`cost ${fix.item}: now ${dollars(item.avgCostCents)}, reviewed as ${dollars(fix.from.avgCostCents)}`);
      continue;
    }
    if (!(fix.to.avgCostCents > 0) || fix.to.avgCostCents >= fix.from.avgCostCents) {
      refusals.push(`cost ${fix.item}: a case-price correction must lower the cost (${dollars(fix.from.avgCostCents)} → ${dollars(fix.to.avgCostCents)})`);
      continue;
    }
    costs.push({
      ...fix,
      holdings: item.venueStock
        .filter((v) => REAL_VENUES.includes(v.venue) && v.onHand)
        .map((v) => ({ venue: v.venue, onHand: v.onHand!, beforeCents: Math.round(v.onHand! * fix.from.avgCostCents), afterCents: Math.round(v.onHand! * fix.to.avgCostCents) }))
    });
  }

  for (const fix of file.measures ?? []) {
    if (!allowed.has(fix.confidence ?? 'high')) continue;
    const item = await prisma.stockItem.findUnique({ where: { id: fix.itemId }, select: { id: true, name: true, measurePerCountUnit: true, measureUnit: true } });
    if (!item) { refusals.push(`measure ${fix.item}: item ${fix.itemId} not found`); continue; }
    if (!same(item.measurePerCountUnit, fix.from.measurePerCountUnit) || (item.measureUnit ?? null) !== (fix.from.measureUnit ?? null)) {
      refusals.push(`measure ${fix.item}: now ${item.measurePerCountUnit} ${item.measureUnit}, reviewed as ${fix.from.measurePerCountUnit} ${fix.from.measureUnit}`);
      continue;
    }
    const recipeLines = await prisma.recipeLine.findMany({ where: { itemId: fix.itemId }, select: { unit: true } });
    const metricRecipeLines = recipeLines.filter((row) => ['g', 'kg', 'ml', 'l'].includes(normaliseUnitLabel(row.unit))).length;
    measures.push({ ...fix, metricRecipeLines });
  }

  const sheetIds = new Set(Object.values(file.sheets ?? {}));
  for (const fix of file.lines ?? []) {
    if (!allowed.has(fix.confidence)) continue;
    const line = await prisma.stocktakeLine.findUnique({
      where: { id: fix.lineId },
      include: { stocktake: { select: { id: true, name: true, venue: true, status: true, appliedAt: true } }, item: true }
    });
    const label = `line ${fix.venue} · ${fix.item}`;
    if (!line || !line.item) { refusals.push(`${label}: line ${fix.lineId} not found or has no item`); continue; }
    if (!sheetIds.has(line.stocktakeId) || file.sheets?.[fix.venue] !== line.stocktakeId) { refusals.push(`${label}: line is on ${line.stocktake.name}, not the reviewed ${fix.venue} sheet`); continue; }
    if (line.stocktake.appliedAt) { refusals.push(`${label}: ${line.stocktake.name} has been applied — correct the holding instead`); continue; }
    if (line.itemId !== fix.itemId) { refusals.push(`${label}: line now points at another item`); continue; }
    if (!same(line.countedQty, fix.from.countedQty) || (line.unit ?? null) !== (fix.from.unit ?? null)) {
      refusals.push(`${label}: now ${line.countedQty} ${line.unit}, reviewed as ${fix.from.countedQty} ${fix.from.unit}`);
      continue;
    }
    const countUnit = line.item.countUnit ?? line.item.unit;
    if (normaliseUnitLabel(fix.to.unit) !== normaliseUnitLabel(countUnit)) { refusals.push(`${label}: target unit ${fix.to.unit} is not the item's count unit ${countUnit}`); continue; }
    const avg = line.item.avgCostCents;
    lines.push({
      ...fix,
      sheetName: line.stocktake.name,
      valueBeforeCents: line.stockValueCents,
      valueAfterCents: fix.to.countedQty === null || avg === null ? null : Math.round(fix.to.countedQty * avg),
      rawApplyCents: Math.round((line.countedQty ?? 0) * (avg ?? 0))
    });
  }

  for (const fix of file.holdings ?? []) {
    if (!allowed.has(fix.confidence)) continue;
    const label = `holding ${fix.venue} · ${fix.item}`;
    const holding = await prisma.venueStockItem.findUnique({ where: { id: fix.holdingId }, include: { stockItem: true } });
    if (!holding) { refusals.push(`${label}: holding ${fix.holdingId} not found`); continue; }
    if (holding.venue !== fix.venue || holding.stockItemId !== fix.itemId) { refusals.push(`${label}: holding is ${holding.venue} / ${holding.stockItemId}`); continue; }
    if (!same(holding.onHand, fix.from.onHand)) { refusals.push(`${label}: on hand is now ${holding.onHand}, reviewed as ${fix.from.onHand}`); continue; }
    const source = await prisma.inventoryMovement.findUnique({ where: { id: fix.sourceMovementId }, include: { sourceStocktake: { select: { venue: true, appliedAt: true } } } });
    if (!source || source.sourceStocktakeLineId !== fix.sourceStocktakeLineId || source.sourceStocktake?.venue !== fix.venue || !source.sourceStocktake?.appliedAt) {
      refusals.push(`${label}: source movement ${fix.sourceMovementId} does not match the reviewed line or sheet`);
      continue;
    }
    if (!same(source.quantityAfter, fix.from.onHand)) { refusals.push(`${label}: source movement wrote ${source.quantityAfter}, not ${fix.from.onHand}`); continue; }
    // Nothing for this item at this venue may have moved since the movement
    // that wrote the bad number, or the "from" no longer means what it did.
    const later = await prisma.inventoryMovement.count({
      where: { itemId: fix.itemId, createdAt: { gt: source.createdAt }, OR: [{ sourceStocktake: { venue: fix.venue } }, { notes: { contains: `Venue: ${fix.venue}` } }] }
    });
    if (later) { refusals.push(`${label}: ${later} movement(s) since the reviewed one`); continue; }
    const avg = holding.stockItem.avgCostCents ?? 0;
    holdings.push({ ...fix, valueBeforeCents: Math.round(fix.from.onHand * avg), valueAfterCents: Math.round(fix.to.onHand * avg) });
  }

  return { costs, measures, lines, holdings, refusals };
}

export function printUnitFixPlan(plan: UnitFixPlan) {
  if (plan.costs.length) {
    console.log(`\n== Costs (${plan.costs.length}) — case or drum price stored as a unit cost`);
    const totals = new Map<string, number>();
    for (const c of plan.costs) {
      console.log(`  [${c.confidence ?? 'high'}] ${c.item}: ${dollars(c.from.avgCostCents)} → ${dollars(c.to.avgCostCents)}`);
      for (const h of c.holdings) {
        console.log(`      ${h.venue}: ${h.onHand} on hand, ${dollars(h.beforeCents)} → ${dollars(h.afterCents)}`);
        totals.set(h.venue, (totals.get(h.venue) ?? 0) + h.afterCents - h.beforeCents);
      }
      console.log(`      ${c.reason}`);
    }
    for (const [venue, delta] of totals) console.log(`  → ${venue}: stock value ${dollars(delta)}`);
  }
  if (!plan.measures.length && !plan.lines.length && !plan.holdings.length) {
    for (const refusal of plan.refusals) console.log(`REFUSED: ${refusal}`);
    return;
  }
  console.log(`\n== Item measures (${plan.measures.length}) — what one count unit holds`);
  for (const m of plan.measures) {
    console.log(`  [${m.confidence ?? 'high'}] ${m.item}: ${m.from.measurePerCountUnit ?? '—'} ${m.from.measureUnit ?? ''} → ${m.to.measurePerCountUnit} ${m.to.measureUnit}${m.metricRecipeLines ? `  (${m.metricRecipeLines} recipe line(s) in g/mL re-cost)` : ''}`);
    console.log(`      ${m.reason}`);
  }
  for (const venue of [...new Set(plan.lines.map((l) => l.venue))]) {
    const mine = plan.lines.filter((l) => l.venue === venue);
    console.log(`\n== ${mine[0]!.sheetName} (${venue}, not yet applied) — ${mine.length} line(s)`);
    for (const l of mine) {
      const to = l.to.countedQty === null ? 'blank (recount)' : `${l.to.countedQty} ${l.to.unit}`;
      console.log(`  [${l.confidence}] ${l.item}: ${l.from.countedQty} ${l.from.unit ?? ''} → ${to}   line value ${dollars(l.valueBeforeCents)} → ${dollars(l.valueAfterCents)}; applied as it stands it would book ${dollars(l.rawApplyCents)}`);
      console.log(`      ${l.reason}`);
    }
    const raw = mine.reduce((s, l) => s + l.rawApplyCents, 0);
    const after = mine.reduce((s, l) => s + (l.valueAfterCents ?? 0), 0);
    console.log(`  → applying this sheet as it stands would book ${dollars(raw)} for these lines; after the restatement ${dollars(after)}.`);
  }
  console.log(`\n== Holdings already written from such a line (${plan.holdings.length}) — corrected with a STOCKTAKE_CORRECTION movement`);
  for (const h of plan.holdings) {
    console.log(`  [${h.confidence}] ${h.venue} · ${h.item}: ${h.from.onHand} → ${h.to.onHand}   ${dollars(h.valueBeforeCents)} → ${dollars(h.valueAfterCents)}   (from line ${h.sourceLine.countedQty} ${h.sourceLine.unit ?? ''})`);
    console.log(`      ${h.reason}`);
  }
  const before = plan.holdings.reduce((s, h) => s + h.valueBeforeCents, 0);
  const after = plan.holdings.reduce((s, h) => s + h.valueAfterCents, 0);
  console.log(`  → holdings ${dollars(before)} → ${dollars(after)} (${dollars(after - before)}).`);
  for (const refusal of plan.refusals) console.log(`REFUSED: ${refusal}`);
}

function noteWith(existing: string | null, addition: string) {
  return existing ? `${existing}\n${addition}` : addition;
}

export async function applyUnitFix(runId: string, plan: UnitFixPlan): Promise<{ movementIds: string[] }> {
  if (plan.refusals.length) throw new Error('plan has refusals — nothing applied');
  const itemIds = [...new Set([...plan.costs.map((c) => c.itemId), ...plan.measures.map((m) => m.itemId), ...plan.holdings.map((h) => h.itemId)])];
  const holdingIds = plan.holdings.map((h) => h.holdingId);
  const lineIds = plan.lines.map((l) => l.lineId);
  const stamp = new Date().toISOString().slice(0, 10);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(`SELECT id FROM "StockItem" WHERE id = ANY($1::text[]) FOR UPDATE`, itemIds);
    await tx.$queryRawUnsafe(`SELECT id FROM "VenueStockItem" WHERE "stockItemId" = ANY($1::text[]) FOR UPDATE`, itemIds);
    const sheetIds = [...new Set((await tx.stocktakeLine.findMany({ where: { id: { in: lineIds } }, select: { stocktakeId: true } })).map((r) => r.stocktakeId))];
    if (sheetIds.length) await tx.$queryRawUnsafe(`SELECT id FROM "Stocktake" WHERE id = ANY($1::text[]) FOR UPDATE`, sheetIds);

    // Snapshot: every row this run will change, plus every venue row of an
    // item whose on-hand total is recomputed.
    const items = await tx.stockItem.findMany({ where: { id: { in: itemIds } } });
    const venueRows = await tx.venueStockItem.findMany({ where: { stockItemId: { in: plan.holdings.map((h) => h.itemId) } } });
    const lineRows = await tx.stocktakeLine.findMany({ where: { id: { in: lineIds } } });
    await backup(tx, runId, 'pre', 'run', [{ id: runId, plan: { costs: plan.costs.length, measures: plan.measures.length, lines: plan.lines.length, holdings: plan.holdings.length } }]);
    await backup(tx, runId, 'pre', 'StockItem', items as unknown as Array<Record<string, unknown>>);
    await backup(tx, runId, 'pre', 'VenueStockItem', venueRows as unknown as Array<Record<string, unknown>>);
    await backup(tx, runId, 'pre', 'StocktakeLine', lineRows as unknown as Array<Record<string, unknown>>);

    // Re-check under the locks: the plan was read outside the transaction.
    for (const l of plan.lines) {
      const row = lineRows.find((r) => r.id === l.lineId)!;
      if (!same(row.countedQty, l.from.countedQty) || (row.unit ?? null) !== (l.from.unit ?? null)) throw new Error(`line ${l.item} changed while planning`);
      const sheet = await tx.stocktake.findUniqueOrThrow({ where: { id: row.stocktakeId }, select: { appliedAt: true } });
      if (sheet.appliedAt) throw new Error(`${l.venue} sheet was applied while planning`);
    }
    for (const h of plan.holdings) {
      const row = venueRows.find((r) => r.id === h.holdingId)!;
      if (!same(row.onHand, h.from.onHand)) throw new Error(`holding ${h.venue} · ${h.item} changed while planning`);
    }

    for (const c of plan.costs) {
      const row = items.find((i) => i.id === c.itemId)!;
      if (row.avgCostCents !== c.from.avgCostCents) throw new Error(`cost ${c.item} changed while planning`);
      await tx.stockItem.update({ where: { id: c.itemId }, data: { avgCostCents: c.to.avgCostCents } });
    }

    for (const m of plan.measures) {
      await tx.stockItem.update({ where: { id: m.itemId }, data: { measurePerCountUnit: m.to.measurePerCountUnit, measureUnit: m.to.measureUnit } });
    }

    for (const l of plan.lines) {
      const row = lineRows.find((r) => r.id === l.lineId)!;
      const was = `${l.from.countedQty} ${l.from.unit ?? ''}`.trim();
      const now = l.to.countedQty === null ? 'blank for a recount' : `${l.to.countedQty} ${l.to.unit}`;
      await tx.stocktakeLine.update({
        where: { id: l.lineId },
        data: {
          countedQty: l.to.countedQty,
          unit: l.to.unit,
          stockValueCents: l.valueAfterCents,
          notes: noteWith(row.notes, `Unit fix ${stamp} (run ${runId}): was ${was}, now ${now}. ${l.reason}`)
        }
      });
    }

    const movementIds: string[] = [];
    for (const h of plan.holdings) {
      const item = items.find((i) => i.id === h.itemId)!;
      const sheet = await tx.stocktake.findUniqueOrThrow({ where: { id: h.sourceStocktakeId }, select: { name: true } });
      const movement = await tx.inventoryMovement.create({
        data: {
          itemId: h.itemId,
          movementType: 'STOCKTAKE_CORRECTION',
          quantityBefore: h.from.onHand,
          quantityAfter: h.to.onHand,
          quantityDelta: h.to.onHand - h.from.onHand,
          unit: item.countUnit ?? item.unit,
          sourceStocktakeId: h.sourceStocktakeId,
          sourceStocktakeLineId: h.sourceStocktakeLineId,
          notes: [
            `Correction for stocktake: ${sheet.name}`,
            `Venue: ${h.venue}`,
            `Reason: ${h.sourceLine.countedQty} ${h.sourceLine.unit ?? ''} was written as ${h.from.onHand} ${item.countUnit ?? item.unit}. ${h.reason}`,
            `Unit fix run ${runId}`
          ].join(' · ')
        }
      });
      movementIds.push(movement.id);
      await tx.venueStockItem.update({ where: { id: h.holdingId }, data: { onHand: h.to.onHand, active: true } });
      const rows = await tx.venueStockItem.findMany({ where: { stockItemId: h.itemId, onHand: { not: null } }, select: { onHand: true } });
      await tx.stockItem.update({ where: { id: h.itemId }, data: { onHand: rows.reduce((sum, r) => sum + (r.onHand ?? 0), 0) } });
    }
    await backup(tx, runId, 'created', 'InventoryMovement', movementIds.map((id) => ({ id })));

    // What the rows look like now, so a rollback can tell our writes from a
    // later human edit.
    await backup(tx, runId, 'post', 'StockItem', (await tx.stockItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, updatedAt: true } })) as unknown as Array<Record<string, unknown>>);
    await backup(tx, runId, 'post', 'VenueStockItem', (await tx.venueStockItem.findMany({ where: { id: { in: venueRows.map((r) => r.id) } }, select: { id: true, updatedAt: true } })) as unknown as Array<Record<string, unknown>>);
    await backup(tx, runId, 'post', 'StocktakeLine', (await tx.stocktakeLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, updatedAt: true } })) as unknown as Array<Record<string, unknown>>);
    return { movementIds };
  }, { maxWait: 15_000, timeout: 120_000 });
}

async function restoreUpdatedAt(tx: Tx, table: string, rows: Array<Record<string, unknown>>) {
  for (const row of rows) {
    if (!row.updatedAt) continue;
    await tx.$executeRawUnsafe(`UPDATE "${table}" SET "updatedAt" = ($1::timestamptz AT TIME ZONE 'UTC') WHERE id = $2`, row.updatedAt, row.id);
  }
}

export async function rollbackUnitFix(runId: string, options: { force?: boolean } = {}) {
  const rows = await prisma.$queryRawUnsafe<Array<{ step: string; tableName: string; rowId: string; payload: Record<string, unknown>; createdAt: Date }>>(
    `SELECT step, "tableName", "rowId", payload, "createdAt" FROM "${UNIT_FIX_BACKUP_TABLE}" WHERE "runId" = $1 ORDER BY id ASC`, runId
  );
  if (!rows.length) throw new Error(`No snapshot for run ${runId}`);
  if (rows.some((r) => r.step === 'rolled_back')) { console.log(`run ${runId} already rolled back`); return; }
  const of = (step: string, table: string) => rows.filter((r) => r.step === step && r.tableName === table).map((r) => r.payload);
  const items = of('pre', 'StockItem');
  const venueRows = of('pre', 'VenueStockItem');
  const lineRows = of('pre', 'StocktakeLine');
  const created = of('created', 'InventoryMovement').map((r) => r.id as string);
  const appliedAt = rows.find((r) => r.step === 'post')?.createdAt ?? rows[0]!.createdAt;

  if (!options.force) {
    // A row edited after the run, or a later movement on one of its items, is
    // a human decision the restore would silently undo.
    const changed: string[] = [];
    for (const [table, model] of [['StockItem', prisma.stockItem], ['VenueStockItem', prisma.venueStockItem], ['StocktakeLine', prisma.stocktakeLine]] as const) {
      for (const post of of('post', table)) {
        const current = await (model as unknown as { findUnique: (a: unknown) => Promise<{ updatedAt: Date } | null> }).findUnique({ where: { id: post.id }, select: { updatedAt: true } });
        if (!current || current.updatedAt.toISOString() !== new Date(post.updatedAt as string).toISOString()) changed.push(`${table} ${post.id}`);
      }
    }
    const itemIds = items.map((i) => i.id as string);
    const later = await prisma.inventoryMovement.count({ where: { itemId: { in: itemIds }, createdAt: { gt: appliedAt }, id: { notIn: created } } });
    const appliedSheets = await prisma.stocktake.count({ where: { appliedAt: { gt: appliedAt }, lines: { some: { id: { in: lineRows.map((l) => l.id as string) } } } } });
    if (changed.length || later || appliedSheets) {
      throw new Error(`run ${runId}: ${changed.length} row(s) edited since (${changed.slice(0, 5).join(', ')}), ${later} later movement(s), ${appliedSheets} restated sheet(s) applied since — decide what should stand, then --force`);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.inventoryMovement.deleteMany({ where: { id: { in: created } } });
    for (const item of items) {
      const { id, ...data } = item as { id: string } & Record<string, unknown>;
      await tx.stockItem.update({ where: { id }, data: data as Prisma.StockItemUncheckedUpdateInput });
    }
    for (const row of venueRows) {
      const { id, ...data } = row as { id: string } & Record<string, unknown>;
      await tx.venueStockItem.update({ where: { id }, data: data as Prisma.VenueStockItemUncheckedUpdateInput });
    }
    for (const row of lineRows) {
      const { id, ...data } = row as { id: string } & Record<string, unknown>;
      await tx.stocktakeLine.update({ where: { id }, data: data as Prisma.StocktakeLineUncheckedUpdateInput });
    }
    await restoreUpdatedAt(tx, 'StockItem', items);
    await restoreUpdatedAt(tx, 'VenueStockItem', venueRows);
    await restoreUpdatedAt(tx, 'StocktakeLine', lineRows);
    await tx.$executeRawUnsafe(`INSERT INTO "${UNIT_FIX_BACKUP_TABLE}" ("runId",step,"tableName","rowId",payload) VALUES ($1,'rolled_back','run',$1,'{}'::jsonb)`, runId);
  }, { maxWait: 15_000, timeout: 120_000 });
  console.log(`Rolled back unit-fix run ${runId}: ${lineRows.length} line(s), ${venueRows.length} holding row(s), ${items.length} item(s) restored; ${created.length} movement(s) removed.`);
}

/**
 * Counted lines on unapplied sheets whose number would change if converted to
 * the item's count unit — i.e. lines that applying would write wrongly. After
 * a full run this should list only lines deliberately left out.
 */
export async function verifyUnitFix(sheetIds: string[]) {
  await loadUnitAliases();
  const sheets = await prisma.stocktake.findMany({ where: { id: { in: sheetIds } }, include: { lines: { include: { item: true } } } });
  for (const sheet of sheets) {
    const off = sheet.lines.filter((line) => {
      if (!line.item || line.countedQty === null) return false;
      const c = convertQuantityToCostUnit(line.countedQty, line.unit, line.item);
      return c.via === 'unknown' ? normaliseUnitLabel(line.unit) !== normaliseUnitLabel(line.item.countUnit ?? line.item.unit) : !same(c.quantity, line.countedQty);
    });
    console.log(`verify: ${sheet.name} (${sheet.venue}${sheet.appliedAt ? ', applied' : ', not applied'}): ${off.length} counted line(s) still in a unit apply would not convert${off.length ? ` — ${off.slice(0, 8).map((l) => `${l.label} ${l.countedQty} ${l.unit}`).join('; ')}` : ''}`);
  }
  const venues = await prisma.$queryRawUnsafe<Array<{ venue: string; cents: number }>>(
    `SELECT v.venue, round(sum(coalesce(v."onHand",0) * coalesce(i."avgCostCents",0)))::float8 AS cents FROM "VenueStockItem" v JOIN "StockItem" i ON i.id = v."stockItemId" WHERE i.status = 'ACTIVE' AND v.venue IN ('Alma Avalon','St Alma') GROUP BY 1 ORDER BY 1`
  );
  for (const v of venues) console.log(`  ${v.venue}: active stock value ${dollars(v.cents)}`);
}
