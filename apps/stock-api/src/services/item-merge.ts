/**
 * Merging duplicate stock items — safely.
 *
 * Two catalogue rows being "the same product" says nothing about the stock
 * they hold. Until 17 Oct 2026 the merge added the two rows' holdings
 * together and added two lines on one count together (applied counts too),
 * which double counted whenever one row held a leftover of an older count and
 * the other the latest, and mixed units whenever the rows counted differently
 * (a 12.5 kg bag added to a per-kilo row as 1 kg). See
 * docs/stock-app-merge-repair-2026-10/README.md.
 *
 * The rules now:
 *   - History is repointed to the kept item exactly as recorded. Count lines
 *     are never added together, deleted or revalued; movements keep their
 *     quantities and their lines.
 *   - Stock on hand is never added together. Per venue: no stock → nothing;
 *     only the kept item holds stock → unchanged; only one duplicate holds
 *     stock → carried across, converted to the kept item's count unit. Two or
 *     more records holding stock, or a unit that cannot be converted, needs
 *     the manager's decision: keep one record's quantity, or enter what is on
 *     the shelf. Nothing is decided for them.
 *   - Holdings stay at their venue; nothing moves between venues.
 *   - A merge is refused while an open count lists two of the records (apply
 *     would keep only one line) or lists a duplicate counted in a unit that
 *     differs from the kept item's.
 *   - planMerge is the preview; mergeItemsWithin re-plans inside the
 *     transaction with the rows locked, and refuses if the plan differs from
 *     what the manager reviewed (planToken). Repeating a completed merge
 *     changes nothing.
 *   - Fields that depend on the unit (measure, costs, par) are copied onto the
 *     kept item only from a duplicate that counts in the same unit.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prismaCogsReader } from '@alma/db';
import type { prisma as PrismaClientInstance } from '@alma/db';
import {
  convertBetweenUnits,
  isMeasureUnit,
  normaliseUnitLabel,
  realVenueNames,
  type StockItemMergeHoldingResolution,
  type StockItemMergePreview,
  type StockItemMergeResult,
  type StockItemMergeVenuePlan
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

type Db = Prisma.TransactionClient | typeof PrismaClientInstance;
const EPS = 1e-9;
const holds = (value: number | null | undefined) => Math.abs(value ?? 0) > EPS;
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

type ItemRow = Prisma.StockItemGetPayload<{ include: { venueStock: true; aliases: true; priceListItems: true } }>;

function toBase(quantity: number, unit: string | null | undefined) {
  if (!isMeasureUnit(unit)) return null;
  for (const base of ['ml', 'g'] as const) {
    const amount = convertBetweenUnits(quantity, unit, base);
    if (amount !== null) return { base, amount };
  }
  return null;
}

/** How much one count unit of an item holds, in g or mL, when that is knowable. */
function basePerCountUnit(item: { unit: string; countUnit: string | null; measurePerCountUnit: number | null; measureUnit: string | null }) {
  const direct = toBase(1, item.countUnit ?? item.unit);
  if (direct) return direct;
  if (item.measurePerCountUnit && item.measurePerCountUnit > 0) return toBase(item.measurePerCountUnit, item.measureUnit);
  return null;
}

/**
 * How many of the kept item's count units one of the duplicate's count units
 * is. 1 for the same unit and size; null when it cannot be known.
 */
export function countUnitFactor(dup: Parameters<typeof basePerCountUnit>[0], kept: Parameters<typeof basePerCountUnit>[0]): number | null {
  const du = normaliseUnitLabel(dup.countUnit ?? dup.unit);
  const ku = normaliseUnitLabel(kept.countUnit ?? kept.unit);
  const db = basePerCountUnit(dup);
  const kb = basePerCountUnit(kept);
  if (du === ku) {
    // Same word, different contents ("each" 12.5 kg bag vs "each" 1 kg bag).
    if (db && kb && db.base === kb.base && Math.abs(db.amount - kb.amount) > EPS) return db.amount / kb.amount;
    return 1;
  }
  if (db && kb && db.base === kb.base) return db.amount / kb.amount;
  return null;
}

const describeUnit = (item: { unit: string; countUnit: string | null }) => item.countUnit ?? item.unit;

async function realVenues(db: Db, candidates: string[]) {
  const configured = await prismaCogsReader.configuredVenues().catch(() => [] as string[]);
  if (configured.length) return new Set(configured);
  return new Set(realVenueNames(candidates));
}

async function loadMembers(db: Db, parentId: string, duplicateIds: string[]) {
  const include = { venueStock: true, aliases: true, priceListItems: true } as const;
  const parent = await db.stockItem.findUnique({ where: { id: parentId }, include });
  if (!parent) throw new HttpError(404, 'The item to keep could not be found.');
  if (parent.status !== 'ACTIVE') throw new HttpError(400, `"${parent.name}" is archived. Keep an active item.`);
  const dupIds = Array.from(new Set(duplicateIds)).filter((id) => id !== parentId);
  if (dupIds.length === 0) throw new HttpError(400, 'Pick at least one different item to merge into the kept one.');
  const dups = await db.stockItem.findMany({ where: { id: { in: dupIds } }, include });
  if (dups.length !== dupIds.length) throw new HttpError(404, 'One or more items to merge could not be found.');
  return { parent, dups };
}

/** A duplicate already merged into this kept item by an earlier run: nothing left to move. */
function alreadyMergedInto(dup: ItemRow, parentId: string) {
  return dup.status === 'ARCHIVED' && (dup.notes ?? '').includes(`(${parentId})`) && dup.venueStock.every((row) => !holds(row.onHand));
}

function mergedElsewhere(dup: ItemRow, parentId: string) {
  if (dup.status !== 'ARCHIVED') return null;
  const match = /Merged into "([^"]*)" \(([^)]+)\)/.exec(dup.notes ?? '');
  return match && match[2] !== parentId ? match[1] : null;
}

export async function planMerge(db: Db, parentId: string, duplicateIds: string[]): Promise<StockItemMergePreview & { _parent: ItemRow; _dups: ItemRow[]; _factors: Map<string, number | null> }> {
  const { parent, dups: allDups } = await loadMembers(db, parentId, duplicateIds);
  for (const dup of allDups) {
    const other = mergedElsewhere(dup, parentId);
    if (other) throw new HttpError(409, `"${dup.name}" was already merged into "${other}".`);
  }
  const done = allDups.filter((dup) => alreadyMergedInto(dup, parentId));
  const dups = allDups.filter((dup) => !done.includes(dup));
  const factors = new Map(dups.map((dup) => [dup.id, countUnitFactor(dup, parent)]));
  const members = [parent, ...dups];
  const memberIds = members.map((m) => m.id);

  // Last applied count per record and venue — shown as a hint only.
  const counted = memberIds.length
    ? await db.stocktakeLine.findMany({
        where: { itemId: { in: memberIds }, countedQty: { not: null }, stocktake: { appliedAt: { not: null } } },
        select: { itemId: true, countedQty: true, stocktake: { select: { venue: true, countedAt: true } } },
        orderBy: { stocktake: { countedAt: 'desc' } }
      })
    : [];
  const lastCount = new Map<string, { at: Date; qty: number | null }>();
  for (const line of counted) {
    const key = `${line.itemId}|${line.stocktake.venue}`;
    if (!lastCount.has(key)) lastCount.set(key, { at: line.stocktake.countedAt, qty: line.countedQty });
  }

  const venueNames = Array.from(new Set(members.flatMap((m) => m.venueStock.map((row) => row.venue)))).sort();
  const venues: StockItemMergeVenuePlan[] = venueNames.map((venue) => {
    const rows = members.map((member) => {
      const row = member.venueStock.find((r) => r.venue === venue);
      const isKept = member.id === parent.id;
      const factor = isKept ? 1 : factors.get(member.id) ?? null;
      const onHand = row?.onHand ?? null;
      const last = lastCount.get(`${member.id}|${venue}`);
      return {
        itemId: member.id,
        name: member.name,
        isKept,
        onHand,
        unit: describeUnit(member),
        onHandInKeptUnit: onHand === null ? null : factor === null ? null : round6(onHand * factor),
        lastCountedAt: last ? last.at.toISOString() : null,
        lastCountedQty: last?.qty ?? null
      };
    });
    const holders = rows.filter((r) => holds(r.onHand));
    const keptRow = rows[0]!;
    const suggested = holders
      .filter((r) => r.lastCountedAt)
      .sort((a, b) => (b.lastCountedAt ?? '').localeCompare(a.lastCountedAt ?? ''))[0];
    const base = { venue, members: rows, suggestedItemId: holders.length > 1 ? suggested?.itemId ?? null : null };
    if (holders.length === 0) return { ...base, outcome: 'nothing' as const, resultOnHand: keptRow.onHand, needsDecision: false, reason: null };
    if (holders.length === 1 && holders[0]!.isKept) return { ...base, outcome: 'keep' as const, resultOnHand: keptRow.onHand, needsDecision: false, reason: null };
    if (holders.length === 1 && holders[0]!.onHandInKeptUnit !== null) {
      return { ...base, outcome: 'carry' as const, resultOnHand: holders[0]!.onHandInKeptUnit, needsDecision: false, reason: null };
    }
    if (holders.length === 1) {
      const h = holders[0]!;
      return {
        ...base, outcome: 'decide' as const, resultOnHand: null, needsDecision: true,
        reason: `"${h.name}" holds ${h.onHand} ${h.unit}, but the kept item counts in ${describeUnit(parent)} and the two cannot be converted. Enter what is on the shelf in ${describeUnit(parent)}, or keep the kept item's quantity.`
      };
    }
    return {
      ...base, outcome: 'decide' as const, resultOnHand: null, needsDecision: true,
      reason: `${holders.length} records hold stock here. They may be the same shelf counted twice, or separate stock. Choose the quantity that is real, or enter what is on the shelf. Nothing is added together.`
    };
  });

  // Open counts: apply keeps one line per item, so two records' lines on one
  // open count would silently drop one; and a duplicate counted in its own
  // unit would be read in the kept item's unit.
  const real = await realVenues(db, venueNames);
  const openLines = await db.stocktakeLine.findMany({
    where: { itemId: { in: memberIds }, stocktake: { appliedAt: null } },
    select: { id: true, itemId: true, countedQty: true, stocktake: { select: { id: true, name: true, venue: true } } }
  });
  const blockers: string[] = [];
  const bySheet = new Map<string, typeof openLines>();
  for (const line of openLines) {
    if (!line.stocktake.venue || !real.has(line.stocktake.venue)) continue;
    bySheet.set(line.stocktake.id, [...(bySheet.get(line.stocktake.id) ?? []), line]);
  }
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  for (const lines of bySheet.values()) {
    const sheet = lines[0]!.stocktake;
    const ids = Array.from(new Set(lines.map((l) => l.itemId!)));
    if (ids.length > 1) {
      blockers.push(`The open count "${sheet.name}" lists ${ids.map((id) => `"${nameOf.get(id)}"`).join(' and ')}. Finish that count, or remove the extra line, before merging.`);
      continue;
    }
    for (const line of lines) {
      const factor = line.itemId === parent.id ? 1 : factors.get(line.itemId!) ?? null;
      if (line.countedQty !== null && factor !== 1) {
        blockers.push(`The open count "${sheet.name}" has "${nameOf.get(line.itemId!)}" counted in ${describeUnit(dups.find((d) => d.id === line.itemId)!)}, not ${describeUnit(parent)}. Finish that count before merging.`);
      }
    }
  }

  const dupIds = dups.map((d) => d.id);
  const count = async (model: 'recipeLine' | 'supplierInvoiceLine', column: 'itemId') =>
    dupIds.length ? (db[model] as unknown as { count: (a: unknown) => Promise<number> }).count({ where: { [column]: { in: dupIds } } }) : 0;
  const repoint = {
    stocktakeLines: dupIds.length ? await db.stocktakeLine.count({ where: { itemId: { in: dupIds } } }) : 0,
    movements: dupIds.length ? await db.inventoryMovement.count({ where: { itemId: { in: dupIds } } }) : 0,
    recipeLines: await count('recipeLine', 'itemId'),
    invoiceLines: await count('supplierInvoiceLine', 'itemId'),
    aliases: dups.reduce((n, d) => n + d.aliases.length, 0),
    purchaseOrderLines: dupIds.length ? await db.purchaseOrderLine.count({ where: { stockItemId: { in: dupIds } } }) : 0
  };

  const costOf = new Map(members.map((m) => [m.id, m.avgCostCents ?? 0]));
  const valueBeforeCents = Math.round(members.reduce((sum, m) => sum + m.venueStock.reduce((s, r) => s + (r.onHand ?? 0) * (costOf.get(m.id) ?? 0), 0), 0));
  const valueAfterCents = Math.round(venues.reduce((sum, v) => sum + (v.resultOnHand ?? v.members[0]!.onHand ?? 0) * (parent.avgCostCents ?? 0), 0));

  const planToken = createHash('sha256')
    .update(JSON.stringify({
      ids: memberIds,
      units: members.map((m) => [m.id, m.unit, m.countUnit, m.measurePerCountUnit, m.measureUnit]),
      holdings: members.flatMap((m) => m.venueStock.map((r) => [m.id, r.venue, r.onHand])).sort(),
      open: openLines.map((l) => [l.id, l.itemId, l.countedQty]).sort()
    }))
    .digest('hex')
    .slice(0, 32);

  return {
    parentId: parent.id,
    parentName: parent.name,
    keptUnit: describeUnit(parent),
    duplicates: allDups.map((d) => ({ id: d.id, name: d.name, unit: describeUnit(d), factor: done.includes(d) ? null : factors.get(d.id) ?? null, alreadyMerged: done.includes(d) })),
    venues,
    blockers,
    repoint,
    valueBeforeCents,
    valueAfterCents,
    planToken,
    alreadyMerged: dups.length === 0,
    _parent: parent,
    _dups: dups,
    _factors: factors
  };
}

export function publicPreview(plan: Awaited<ReturnType<typeof planMerge>>): StockItemMergePreview {
  const { _parent, _dups, _factors, ...rest } = plan;
  void _parent; void _dups; void _factors;
  return rest;
}

/** The kept item's holding at one venue after the merge, from the plan and the manager's decision. */
function resolveVenue(v: StockItemMergeVenuePlan, decision: StockItemMergeHoldingResolution | undefined): { onHand: number | null; why: string } {
  if (!decision) {
    if (v.needsDecision) throw new HttpError(409, `${v.venue}: ${v.reason ?? 'a decision is needed'}`);
    const carried = v.members.find((m) => !m.isKept && holds(m.onHand));
    return { onHand: v.resultOnHand, why: v.outcome === 'carry' && carried ? `carried "${carried.name}" ${carried.onHand} ${carried.unit}` : 'kept item unchanged' };
  }
  if (decision.keep === 'keep') return { onHand: v.members[0]!.onHand, why: 'manager kept the kept item\'s quantity' };
  if (decision.keep === 'counted') {
    if (decision.countedQty === undefined) throw new HttpError(400, `${v.venue}: enter the counted quantity.`);
    return { onHand: round6(decision.countedQty), why: `manager entered the counted quantity ${decision.countedQty}` };
  }
  const member = v.members.find((m) => !m.isKept && m.itemId === decision.itemId);
  if (!member) throw new HttpError(400, `${v.venue}: pick one of the records being merged.`);
  if (member.onHandInKeptUnit === null && holds(member.onHand)) throw new HttpError(400, `${v.venue}: "${member.name}" cannot be converted to the kept item's unit. Enter the counted quantity instead.`);
  return { onHand: member.onHandInKeptUnit, why: `manager kept "${member.name}" ${member.onHand} ${member.unit}` };
}

export async function mergeItemsWithin(
  tx: Prisma.TransactionClient,
  options: { parentId: string; duplicateIds: string[]; actorName?: string; holdings?: StockItemMergeHoldingResolution[]; planToken?: string }
): Promise<StockItemMergeResult> {
  const actorName = options.actorName?.trim() || 'system';
  const ids = Array.from(new Set([options.parentId, ...options.duplicateIds]));
  // Lock the records and every count that lists them, so a count being saved
  // waits for the merge instead of interleaving with it, and two clicks on
  // Merge run one after the other.
  await tx.$queryRawUnsafe(`SELECT id FROM "StockItem" WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`, ids);
  const sheetIds = (await tx.stocktakeLine.findMany({ where: { itemId: { in: ids } }, select: { stocktakeId: true }, distinct: ['stocktakeId'] })).map((l) => l.stocktakeId);
  if (sheetIds.length) await tx.$queryRawUnsafe(`SELECT id FROM "Stocktake" WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`, sheetIds);

  const plan = await planMerge(tx, options.parentId, options.duplicateIds);
  const emptyMoved = { recipeLines: 0, stocktakeLines: 0, invoiceLines: 0, movements: 0, aliases: 0, priceListItems: 0, purchaseOrderLines: 0 };
  if (plan.alreadyMerged) return { parentId: plan.parentId, mergedCount: 0, venuesAdded: [], alreadyMerged: true, holdings: [], moved: emptyMoved };
  if (options.planToken && options.planToken !== plan.planToken) {
    throw new HttpError(409, 'Stock or counts for these items changed since you reviewed the merge. Review it again.');
  }
  if (plan.blockers.length) throw new HttpError(409, plan.blockers.join(' '));
  const decisions = new Map((options.holdings ?? []).map((h) => [h.venue, h]));
  for (const venue of decisions.keys()) {
    if (!plan.venues.some((v) => v.venue === venue)) throw new HttpError(400, `None of these items has stock at ${venue}.`);
  }
  const targets = plan.venues.map((v) => ({ v, ...resolveVenue(v, decisions.get(v.venue)) }));

  const parent = plan._parent;
  const dups = plan._dups;
  const dupIds = dups.map((d) => d.id);
  const moved = { ...emptyMoved };

  // 1. History: repoint, never fold. Every count line keeps its quantity,
  //    unit, value and notes; it now names the kept item.
  moved.stocktakeLines = (await tx.stocktakeLine.updateMany({ where: { itemId: { in: dupIds } }, data: { itemId: parent.id } })).count;
  moved.recipeLines = (await tx.recipeLine.updateMany({ where: { itemId: { in: dupIds } }, data: { itemId: parent.id } })).count;
  moved.movements = (await tx.inventoryMovement.updateMany({ where: { itemId: { in: dupIds } }, data: { itemId: parent.id } })).count;
  moved.invoiceLines = (await tx.supplierInvoiceLine.updateMany({ where: { itemId: { in: dupIds } }, data: { itemId: parent.id } })).count;
  await tx.stockTransfer.updateMany({ where: { stockItemId: { in: dupIds } }, data: { stockItemId: parent.id } });
  await tx.stockWastageRecord.updateMany({ where: { stockItemId: { in: dupIds } }, data: { stockItemId: parent.id } });
  await tx.stockDeliveryCheckItem.updateMany({ where: { stockItemId: { in: dupIds } }, data: { stockItemId: parent.id } });
  await tx.stockReorderNotice.updateMany({ where: { stockItemId: { in: dupIds } }, data: { stockItemId: parent.id } });
  await tx.squareMenuRecipeMapping.updateMany({ where: { stockItemId: { in: dupIds } }, data: { stockItemId: parent.id } });
  moved.purchaseOrderLines = (await tx.purchaseOrderLine.updateMany({ where: { stockItemId: { in: dupIds } }, data: { stockItemId: parent.id } })).count;

  // 2. Supplier aliases and price lists (unique per supplier): the kept item's own win.
  const parentAliasKeys = new Set(parent.aliases.map((a) => `${a.aliasKey}|${a.supplierId ?? ''}`));
  for (const dup of dups) {
    for (const alias of dup.aliases) {
      const key = `${alias.aliasKey}|${alias.supplierId ?? ''}`;
      if (parentAliasKeys.has(key)) await tx.stockItemAlias.delete({ where: { id: alias.id } });
      else {
        await tx.stockItemAlias.update({ where: { id: alias.id }, data: { stockItemId: parent.id } });
        parentAliasKeys.add(key);
      }
      moved.aliases += 1;
    }
  }
  const parentSuppliers = new Set(parent.priceListItems.map((r) => r.supplierId));
  for (const dup of dups) {
    for (const row of dup.priceListItems) {
      if (parentSuppliers.has(row.supplierId)) await tx.supplierPriceListItem.delete({ where: { id: row.id } });
      else {
        await tx.supplierPriceListItem.update({ where: { id: row.id }, data: { stockItemId: parent.id } });
        parentSuppliers.add(row.supplierId);
      }
      moved.priceListItems += 1;
    }
  }

  // 3. Holdings, venue by venue — never added together.
  const venuesAdded: string[] = [];
  const holdingResults: NonNullable<StockItemMergeResult['holdings']> = [];
  const now = new Date();
  for (const { v, onHand, why } of targets) {
    const keptRow = parent.venueStock.find((r) => r.venue === v.venue);
    const dupRows = dups.flatMap((d) => d.venueStock.filter((r) => r.venue === v.venue).map((r) => ({ dup: d, row: r })));
    const before = keptRow?.onHand ?? null;
    const active = (keptRow?.active ?? false) || dupRows.some((x) => x.row.active);
    if (keptRow) {
      await tx.venueStockItem.update({ where: { id: keptRow.id }, data: { onHand, active } });
      for (const x of dupRows) await tx.venueStockItem.delete({ where: { id: x.row.id } });
    } else if (dupRows.length) {
      // The kept item had no row here: take one duplicate's row (keeps its
      // reorder settings) and set the decided quantity.
      const [first, ...rest] = dupRows;
      await tx.venueStockItem.update({ where: { id: first!.row.id }, data: { stockItemId: parent.id, onHand, active } });
      for (const x of rest) await tx.venueStockItem.delete({ where: { id: x.row.id } });
      venuesAdded.push(v.venue);
    }
    holdingResults.push({ venue: v.venue, before, after: onHand });
    const note = `${v.venue}: duplicate merge by ${actorName} — ${why}; nothing added together`;
    if (Math.abs((onHand ?? 0) - (before ?? 0)) > EPS) {
      await tx.inventoryMovement.create({
        data: { itemId: parent.id, movementType: 'STOCKTAKE_CORRECTION', quantityBefore: before ?? 0, quantityAfter: onHand ?? 0, quantityDelta: (onHand ?? 0) - (before ?? 0), unit: describeUnit(parent), createdAt: now, notes: note }
      });
    }
    for (const x of dupRows) {
      if (!holds(x.row.onHand)) continue;
      await tx.inventoryMovement.create({
        data: { itemId: x.dup.id, movementType: 'STOCKTAKE_CORRECTION', quantityBefore: x.row.onHand ?? 0, quantityAfter: 0, quantityDelta: -(x.row.onHand ?? 0), unit: describeUnit(x.dup), createdAt: now, notes: `${v.venue}: merged into "${parent.name}" (${parent.id}) by ${actorName} — ${why}` }
      });
    }
  }

  // 4. Fill blanks on the kept item. Unit-dependent fields only from a
  //    duplicate that counts in the same unit and size.
  const sameUnit = dups.filter((d) => plan._factors.get(d.id) === 1);
  const first = <T>(list: ItemRow[], pick: (d: ItemRow) => T | null | undefined) => list.map(pick).find((v) => v !== null && v !== undefined && v !== '');
  const backfill: Prisma.StockItemUpdateInput = {};
  if (!parent.sku) {
    const source = dups.find((d) => d.sku);
    if (source?.sku) {
      await tx.stockItem.update({ where: { id: source.id }, data: { sku: null } });
      backfill.sku = source.sku;
    }
  }
  if (!parent.categoryId) {
    const categoryId = first(dups, (d) => d.categoryId);
    if (categoryId) backfill.category = { connect: { id: categoryId } };
  }
  if (!parent.countArea) {
    const area = first(dups, (d) => d.countArea);
    if (area) backfill.countArea = area;
  }
  if (!parent.countUnit) {
    const source = sameUnit.find((d) => d.countUnit);
    if (source?.countUnit) {
      backfill.countUnit = source.countUnit;
      if ((parent.conversionFactor ?? 1) === 1 && source.conversionFactor > 0) backfill.conversionFactor = source.conversionFactor;
    }
  }
  if (parent.measurePerCountUnit === null) {
    const source = sameUnit.find((d) => d.measurePerCountUnit);
    if (source) { backfill.measurePerCountUnit = source.measurePerCountUnit; backfill.measureUnit = source.measureUnit; }
  }
  if (parent.latestCostCents === null) {
    const source = sameUnit.find((d) => d.latestCostCents !== null);
    if (source) { backfill.latestCostCents = source.latestCostCents; backfill.latestCostAt = source.latestCostAt; }
  }
  if (parent.avgCostCents === null) {
    const cost = first(sameUnit, (d) => d.avgCostCents);
    if (cost !== undefined) backfill.avgCostCents = cost;
  }
  if (parent.reorderPoint === null) {
    const point = first(sameUnit, (d) => d.reorderPoint);
    if (point !== undefined) backfill.reorderPoint = point;
  }
  if (!parent.parLevel) {
    const source = sameUnit.find((d) => d.parLevel > 0);
    if (source) backfill.parLevel = source.parLevel;
  }
  const rows = await tx.venueStockItem.findMany({ where: { stockItemId: parent.id, onHand: { not: null } }, select: { onHand: true } });
  await tx.stockItem.update({ where: { id: parent.id }, data: { ...backfill, onHand: rows.reduce((sum, r) => sum + (r.onHand ?? 0), 0) } });

  // 5. Archive the duplicates with a note saying where everything went.
  const stamp = now.toISOString().slice(0, 10);
  for (const dup of dups) {
    const mergeNote = `Merged into "${parent.name}" (${parent.id}) on ${stamp} by ${actorName}.`;
    await tx.stockItem.update({
      where: { id: dup.id },
      data: { status: 'ARCHIVED', onHand: 0, notes: dup.notes?.trim() ? `${dup.notes.trim()}\n\n${mergeNote}` : mergeNote }
    });
  }

  return { parentId: parent.id, mergedCount: dups.length, venuesAdded, holdings: holdingResults, moved };
}
