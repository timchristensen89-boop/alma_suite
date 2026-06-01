import type { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import {
  stocktakeCorrectionInputSchema,
  stocktakeBulkDeleteInputSchema,
  stocktakeCreateInputSchema,
  stocktakeReversalInputSchema,
  stocktakeUpdateInputSchema,
  type ApplyStocktakeResult,
  type InventoryMovement,
  type StocktakeMovement,
  type StocktakeMovementHistoryPayload,
  type StocktakeMovementResult,
  type StocktakeReviewItem,
  type Stocktake,
  type StocktakeLine,
  type StocktakeWithLines,
  type StocktakesPayload,
  type AuthUser,
  type StocktakesSummary
} from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { convertQuantityToCostUnit } from './units.js';

type LineCostItem = {
  unit: string;
  countUnit: string | null;
  conversionFactor: number | null;
  avgCostCents: number | null;
};

// Value a stocktake line server-side: counted quantity (converted into the
// item's cost unit) × the item's average cost. Client-supplied values are NOT
// trusted. Lines with no linked item or no cost basis are left unvalued (null).
function stocktakeLineValueCents(
  countedQty: number | null | undefined,
  unit: string | null | undefined,
  item: LineCostItem | undefined
): number | null {
  if (!item || item.avgCostCents === null || countedQty === null || countedQty === undefined) {
    return null;
  }
  const { quantity } = convertQuantityToCostUnit(countedQty, unit ?? null, item);
  return Math.round(item.avgCostCents * quantity);
}

async function loadLineCostItems(
  client: Prisma.TransactionClient,
  lines: { itemId?: string | null }[] | undefined
): Promise<Map<string, LineCostItem>> {
  const ids = [
    ...new Set(
      (lines ?? [])
        .map((line) => (line.itemId ? line.itemId.trim() : ''))
        .filter((value): value is string => value.length > 0)
    )
  ];
  if (!ids.length) return new Map();
  const items = await client.stockItem.findMany({
    where: { id: { in: ids } },
    select: { id: true, unit: true, countUnit: true, conversionFactor: true, avgCostCents: true }
  });
  return new Map(items.map((item) => [item.id, item]));
}

type StocktakeRow = Prisma.StocktakeGetPayload<{
  include: {
    _count: { select: { lines: true } };
    lines: { select: { stockValueCents: true } };
  };
}>;

type StocktakeWithLinesRow = Prisma.StocktakeGetPayload<{
  include: {
    lines: {
      include: { item: { select: { id: true; name: true; unit: true; onHand: true } } };
    };
  };
}>;

type StocktakeLineRow = StocktakeWithLinesRow['lines'][number];

type InventoryMovementRow = Prisma.InventoryMovementGetPayload<object>;

type InventoryMovementWithContextRow = Prisma.InventoryMovementGetPayload<{
  include: {
    item: { select: { id: true; name: true; unit: true; onHand: true } };
    sourceStocktakeLine: {
      select: { id: true; label: true; countedQty: true; unit: true; location: true };
    };
  };
}>;

type StocktakeReviewRow = Prisma.StocktakeGetPayload<{
  include: {
    _count: { select: { lines: true } };
    lines: {
      select: {
        countedQty: true;
        stockValueCents: true;
        unit: true;
        item: { select: { id: true; onHand: true } };
      };
    };
  };
}>;

function normaliseOptionalText(value: string | undefined) {
  if (value === undefined) return undefined;
  return value.trim() || null;
}

function sumLineValueCents(lines: { stockValueCents: number | null }[]): number {
  return lines.reduce((sum, line) => sum + (line.stockValueCents ?? 0), 0);
}

function toStocktakePayload(row: StocktakeRow): Stocktake {
  return {
    id: row.id,
    legacyId: row.legacyId,
    name: row.name,
    venue: row.venue,
    template: row.template,
    countedAt: row.countedAt.toISOString(),
    status: row.status,
    notes: row.notes,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    submittedByUserId: row.submittedByUserId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewedByUserId: row.reviewedByUserId,
    lineCount: row._count.lines,
    totalValueCents: sumLineValueCents(row.lines),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toLinePayload(row: StocktakeLineRow): StocktakeLine {
  return {
    id: row.id,
    legacyId: row.legacyId,
    stocktakeId: row.stocktakeId,
    itemId: row.itemId,
    item: row.item ?? null,
    position: row.position,
    label: row.label,
    countedQty: row.countedQty,
    unit: row.unit,
    location: row.location,
    stockValueCents: row.stockValueCents,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toStocktakeWithLinesPayload(row: StocktakeWithLinesRow): StocktakeWithLines {
  const totalValueCents = row.lines.reduce(
    (sum, line) => sum + (line.stockValueCents ?? 0),
    0
  );
  return {
    id: row.id,
    legacyId: row.legacyId,
    name: row.name,
    venue: row.venue,
    template: row.template,
    countedAt: row.countedAt.toISOString(),
    status: row.status,
    notes: row.notes,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    submittedByUserId: row.submittedByUserId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewedByUserId: row.reviewedByUserId,
    lineCount: row.lines.length,
    totalValueCents,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lines: row.lines
      .slice()
      .sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        return a.label.localeCompare(b.label);
      })
      .map(toLinePayload)
  };
}

function toMovementPayload(row: InventoryMovementRow): InventoryMovement {
  return {
    id: row.id,
    itemId: row.itemId,
    movementType: row.movementType,
    quantityDelta: row.quantityDelta,
    quantityBefore: row.quantityBefore,
    quantityAfter: row.quantityAfter,
    unit: row.unit,
    sourceStocktakeId: row.sourceStocktakeId,
    sourceStocktakeLineId: row.sourceStocktakeLineId,
    notes: row.notes,
    createdAt: row.createdAt.toISOString()
  };
}

function toMovementWithContextPayload(row: InventoryMovementWithContextRow): StocktakeMovement {
  return {
    ...toMovementPayload(row),
    item: row.item,
    sourceStocktakeLine: row.sourceStocktakeLine
  };
}

function reviewerLabel(reviewer?: AuthUser | null) {
  if (!reviewer) return null;
  return `${reviewer.firstName} ${reviewer.lastName}`.trim() || reviewer.email || reviewer.id;
}

function notesWithContext(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(' · ');
}

function reversalSinceAppliedWhere(stocktakeId: string, appliedAt: Date | null) {
  return {
    sourceStocktakeId: stocktakeId,
    movementType: 'STOCKTAKE_REVERSAL' as const,
    ...(appliedAt ? { createdAt: { gte: appliedAt } } : {})
  };
}

function isAdminActor(actor?: AuthUser | null) {
  return Boolean(actor?.isAdmin || actor?.role === 'ADMIN');
}

function stocktakeScope(actor?: AuthUser | null): Prisma.StocktakeWhereInput {
  if (!actor || isAdminActor(actor)) return {};
  if (!actor.venue) return { id: '__no_stocktake_scope__' };
  return { OR: [{ venue: actor.venue }, { venue: null }] };
}

function scopedStocktakeWhere(id: string, actor?: AuthUser | null): Prisma.StocktakeWhereInput {
  return { AND: [{ id }, stocktakeScope(actor)] };
}

function targetVenueForActor(requestedVenue: string | null | undefined, actor?: AuthUser | null) {
  if (!actor || isAdminActor(actor)) return requestedVenue ?? null;
  if (!actor.venue) throw new HttpError(403, 'Stocktake actions require a venue-scoped manager.');
  if (requestedVenue && requestedVenue !== actor.venue) {
    throw new HttpError(403, 'Stocktake actions are limited to your venue.');
  }
  return actor.venue;
}

function assertVenueChangeAllowed(
  requestedVenue: string | null | undefined,
  existingVenue: string | null,
  actor?: AuthUser | null
) {
  if (!actor || isAdminActor(actor)) return requestedVenue ?? existingVenue;
  return targetVenueForActor(requestedVenue ?? existingVenue, actor);
}

async function balanceTargetForItem(
  tx: Prisma.TransactionClient,
  itemId: string,
  venue: string | null
) {
  const item = await tx.stockItem.findUnique({
    where: { id: itemId },
    select: { id: true, unit: true, onHand: true, parLevel: true, reorderPoint: true }
  });
  if (!item) return null;

  if (!venue) {
    return {
      item,
      quantityBefore: item.onHand,
      updateQuantityAfter: (quantityAfter: number) =>
        tx.stockItem.update({
          where: { id: item.id },
          data: { onHand: quantityAfter }
        })
    };
  }

  const venueStock = await tx.venueStockItem.upsert({
    where: { venue_stockItemId: { venue, stockItemId: item.id } },
    create: {
      venue,
      stockItemId: item.id,
      parLevel: item.parLevel,
      reorderPoint: item.reorderPoint,
      onHand: null,
      active: true
    },
    update: {}
  });

  return {
    item,
    quantityBefore: venueStock.onHand ?? item.onHand,
    updateQuantityAfter: (quantityAfter: number) =>
      tx.venueStockItem.update({
        where: { id: venueStock.id },
        data: { onHand: quantityAfter, active: true }
      })
  };
}

async function ensureVenueStockRowsForLines(
  tx: Prisma.TransactionClient,
  venue: string | null,
  itemIds: Array<string | null | undefined>
) {
  if (!venue) return;
  const uniqueItemIds = Array.from(new Set(itemIds.filter((id): id is string => Boolean(id))));
  if (uniqueItemIds.length === 0) return;
  const items = await tx.stockItem.findMany({
    where: { id: { in: uniqueItemIds } },
    select: { id: true, parLevel: true, reorderPoint: true, status: true }
  });
  for (const item of items) {
    await tx.venueStockItem.upsert({
      where: { venue_stockItemId: { venue, stockItemId: item.id } },
      create: {
        venue,
        stockItemId: item.id,
        parLevel: item.parLevel,
        reorderPoint: item.reorderPoint,
        onHand: null,
        active: item.status === 'ACTIVE'
      },
      update: {}
    });
  }
}

async function venueOnHandLookup(
  rows: Array<{
    venue: string | null;
    lines: Array<{ itemId?: string | null; item: { id: string } | null }>;
  }>
) {
  const venues = Array.from(
    new Set(rows.map((row) => row.venue?.trim()).filter((venue): venue is string => Boolean(venue)))
  );
  const itemIds = Array.from(
    new Set(
      rows.flatMap((row) =>
        row.lines.flatMap((line) => {
          const itemId = line.itemId ?? line.item?.id ?? null;
          return itemId ? [itemId] : [];
        })
      )
    )
  );

  if (venues.length === 0 || itemIds.length === 0) {
    return new Map<string, number | null>();
  }

  const venueRows = await prisma.venueStockItem.findMany({
    where: {
      venue: { in: venues },
      stockItemId: { in: itemIds }
    },
    select: { venue: true, stockItemId: true, onHand: true }
  });

  return new Map(venueRows.map((row) => [`${row.venue}:${row.stockItemId}`, row.onHand] as const));
}

function effectiveVenueOnHand(
  venue: string | null,
  itemId: string | null | undefined,
  fallback: number,
  venueOnHandByKey?: Map<string, number | null>
) {
  if (!venue || !itemId) return fallback;
  const venueOnHand = venueOnHandByKey?.get(`${venue}:${itemId}`);
  return venueOnHand ?? fallback;
}

async function hydrateStocktakeWithVenueOnHand(row: StocktakeWithLinesRow) {
  const venueOnHandByKey = await venueOnHandLookup([row]);
  return {
    ...row,
    lines: row.lines.map((line) =>
      line.item
        ? {
            ...line,
            item: {
              ...line.item,
              onHand: effectiveVenueOnHand(row.venue, line.itemId ?? line.item.id, line.item.onHand, venueOnHandByKey)
            }
          }
        : line
    )
  };
}

async function loadStocktakeWithVenueOnHand(id: string, actor?: AuthUser | null): Promise<StocktakeWithLines> {
  const row = await prisma.stocktake.findFirst({
    where: scopedStocktakeWhere(id, actor),
    include: {
      lines: {
        include: { item: { select: { id: true, name: true, unit: true, onHand: true } } }
      }
    }
  });
  if (!row) throw new HttpError(404, 'Stocktake not found');
  const hydrated = await hydrateStocktakeWithVenueOnHand(row);
  return toStocktakeWithLinesPayload(hydrated);
}

function reviewLineValue(lines: StocktakeReviewRow['lines']) {
  return lines.reduce((sum, line) => sum + (line.stockValueCents ?? 0), 0);
}

function toStocktakeReviewPayload(
  row: StocktakeReviewRow,
  venueOnHandByKey?: Map<string, number | null>
): StocktakeReviewItem {
  const variance = row.lines.reduce(
    (summary, line) => {
      if (!line.item) return summary;
      const onHand = effectiveVenueOnHand(row.venue, line.item.id, line.item.onHand, venueOnHandByKey);
      const delta = line.countedQty - onHand;
      if (Math.abs(delta) > 0.0001) summary.varianceLineCount += 1;
      summary.totalVarianceQuantity += delta;
      if (delta > 0) summary.positiveVarianceQuantity += delta;
      if (delta < 0) summary.negativeVarianceQuantity += delta;
      return summary;
    },
    {
      varianceLineCount: 0,
      totalVarianceQuantity: 0,
      positiveVarianceQuantity: 0,
      negativeVarianceQuantity: 0
    }
  );

  return {
    id: row.id,
    legacyId: row.legacyId,
    name: row.name,
    venue: row.venue,
    template: row.template,
    countedAt: row.countedAt.toISOString(),
    status: row.status,
    notes: row.notes,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    submittedByUserId: row.submittedByUserId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewedByUserId: row.reviewedByUserId,
    lineCount: row._count.lines,
    totalValueCents: reviewLineValue(row.lines),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...variance
  };
}

export const stocktakesService = {
  async list(actor?: AuthUser | null): Promise<StocktakesPayload> {
    const stocktakes = await prisma.stocktake.findMany({
      where: stocktakeScope(actor),
      include: {
        _count: { select: { lines: true } },
        lines: { select: { stockValueCents: true } }
      },
      orderBy: { countedAt: 'desc' }
    });
    return { stocktakes: stocktakes.map(toStocktakePayload) };
  },

  async summary(actor?: AuthUser | null): Promise<StocktakesSummary> {
    const scope = stocktakeScope(actor);
    const [total, inProgress, submitted, applied, latest, valueAgg] = await Promise.all([
      prisma.stocktake.count({ where: scope }),
      prisma.stocktake.count({ where: { AND: [scope, { status: 'IN_PROGRESS' }] } }),
      prisma.stocktake.count({ where: { AND: [scope, { status: 'SUBMITTED' }] } }),
      prisma.stocktake.count({ where: { AND: [scope, { appliedAt: { not: null } }] } }),
      prisma.stocktake.findFirst({
        where: scope,
        orderBy: { countedAt: 'desc' },
        select: { countedAt: true }
      }),
      prisma.stocktakeLine.aggregate({
        where: { stocktake: scope },
        _sum: { stockValueCents: true }
      })
    ]);

    return {
      totalStocktakes: total,
      inProgress,
      submitted,
      applied,
      lastCountedAt: latest?.countedAt.toISOString() ?? null,
      totalValueCents: valueAgg._sum.stockValueCents ?? 0
    };
  },

  async get(id: string, actor?: AuthUser | null): Promise<StocktakeWithLines> {
    return loadStocktakeWithVenueOnHand(id, actor);
  },

  async createStocktake(input: unknown, actor?: AuthUser | null): Promise<StocktakeWithLines> {
    const data = stocktakeCreateInputSchema.parse(input);
    const countedAt = new Date(data.countedAt);
    if (Number.isNaN(countedAt.getTime())) {
      throw new HttpError(400, 'countedAt is not a valid date');
    }
    const requestedVenue = normaliseOptionalText(data.venue);
    const venue = targetVenueForActor(requestedVenue, actor);
    const submittedAt = data.status === 'SUBMITTED' ? new Date() : null;

    const row = await prisma.$transaction(async (tx) => {
      const costById = await loadLineCostItems(tx, data.lines);
      const created = await tx.stocktake.create({
        data: {
          name: data.name.trim(),
          venue,
          template: normaliseOptionalText(data.template) ?? null,
          countedAt,
          status: data.status,
          submittedAt,
          submittedByUserId: submittedAt ? actor?.id ?? null : null,
          notes: normaliseOptionalText(data.notes) ?? null,
          lines: data.lines
            ? {
                create: data.lines.map((line, index) => ({
                  position: index + 1,
                  label: line.label.trim(),
                  itemId: normaliseOptionalText(line.itemId) ?? null,
                  countedQty: line.countedQty,
                  unit: normaliseOptionalText(line.unit) ?? null,
                  location: normaliseOptionalText(line.location) ?? null,
                  stockValueCents: stocktakeLineValueCents(
                    line.countedQty,
                    line.unit,
                    costById.get(normaliseOptionalText(line.itemId) ?? '')
                  ),
                  notes: normaliseOptionalText(line.notes) ?? null
                }))
              }
            : undefined
        },
        include: {
          lines: {
            include: { item: { select: { id: true, name: true, unit: true, onHand: true } } }
          }
        }
      });
      await ensureVenueStockRowsForLines(
        tx,
        venue,
        created.lines.map((line) => line.itemId)
      );
      return created;
    });
    return loadStocktakeWithVenueOnHand(row.id, actor);
  },

  async updateStocktake(
    id: string,
    input: unknown,
    actor?: AuthUser | null
  ): Promise<StocktakeWithLines> {
    const data = stocktakeUpdateInputSchema.parse(input);
    const existing = await prisma.stocktake.findFirst({ where: scopedStocktakeWhere(id, actor) });
    if (!existing) throw new HttpError(404, 'Stocktake not found');
    let reversedAfterApply = false;
    if (existing.appliedAt) {
      reversedAfterApply = await prisma.inventoryMovement.count({
        where: reversalSinceAppliedWhere(id, existing.appliedAt)
      }) > 0;
      if (!reversedAfterApply) {
        throw new HttpError(409, 'Applied stocktakes cannot be edited until a reversal movement exists');
      }
    }

    let countedAt: Date | undefined;
    if (data.countedAt !== undefined) {
      countedAt = new Date(data.countedAt);
      if (Number.isNaN(countedAt.getTime())) {
        throw new HttpError(400, 'countedAt is not a valid date');
      }
    }

    const requestedVenue =
      data.venue !== undefined ? normaliseOptionalText(data.venue) : existing.venue;
    const venue = assertVenueChangeAllowed(requestedVenue, existing.venue, actor);
    const statusChanged = data.status !== undefined && data.status !== existing.status;
    const nextStatus = data.status ?? existing.status;
    const now = new Date();

    const row = await prisma.$transaction(async (tx) => {
      if (data.lines !== undefined) {
        await tx.stocktakeLine.deleteMany({ where: { stocktakeId: id } });
      }
      const costById = await loadLineCostItems(tx, data.lines);

      const updated = await tx.stocktake.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name.trim() }),
          ...(data.venue !== undefined && { venue }),
          ...(data.template !== undefined && {
            template: normaliseOptionalText(data.template)
          }),
          ...(countedAt !== undefined && { countedAt }),
          ...(data.status !== undefined && { status: data.status }),
          ...(statusChanged && nextStatus === 'SUBMITTED' && {
            submittedAt: now,
            submittedByUserId: actor?.id ?? null
          }),
          ...(statusChanged && nextStatus === 'IN_PROGRESS' && {
            submittedAt: null,
            submittedByUserId: null,
            reviewedAt: null,
            reviewedByUserId: null
          }),
          ...(data.notes !== undefined && { notes: normaliseOptionalText(data.notes) }),
          ...(reversedAfterApply && {
            appliedAt: null,
            status: data.status ?? 'IN_PROGRESS'
          }),
          ...(data.lines !== undefined && {
            lines: {
              create: data.lines.map((line, index) => ({
                position: index + 1,
                label: line.label.trim(),
                itemId: normaliseOptionalText(line.itemId) ?? null,
                countedQty: line.countedQty,
                unit: normaliseOptionalText(line.unit) ?? null,
                location: normaliseOptionalText(line.location) ?? null,
                stockValueCents: stocktakeLineValueCents(
                  line.countedQty,
                  line.unit,
                  costById.get(normaliseOptionalText(line.itemId) ?? '')
                ),
                notes: normaliseOptionalText(line.notes) ?? null
              }))
            }
          })
        },
        include: {
          lines: {
            include: { item: { select: { id: true, name: true, unit: true, onHand: true } } }
          }
        }
      });
      await ensureVenueStockRowsForLines(
        tx,
        venue,
        updated.lines.map((line) => line.itemId)
      );
      return updated;
    }, { maxWait: 15_000, timeout: 30_000 });
    return loadStocktakeWithVenueOnHand(row.id, actor);
  },

  async applyStocktake(id: string, reviewer?: AuthUser | null): Promise<ApplyStocktakeResult> {
    const reviewedBy = reviewerLabel(reviewer);
    const result = await prisma.$transaction(async (tx) => {
      const stocktake = await tx.stocktake.findUnique({
        where: { id },
        include: {
          lines: {
            orderBy: [{ position: 'asc' }, { label: 'asc' }],
            include: { item: { select: { id: true, name: true, unit: true, onHand: true } } }
          }
        }
      });

      if (!stocktake) throw new HttpError(404, 'Stocktake not found');
      if (
        reviewer &&
        !isAdminActor(reviewer) &&
        (!reviewer.venue || (stocktake.venue !== reviewer.venue && stocktake.venue !== null))
      ) {
        throw new HttpError(403, 'Stocktake review is limited to your venue.');
      }
      if (stocktake.status !== 'SUBMITTED') {
        throw new HttpError(400, 'Only submitted stocktakes can be applied');
      }
      if (stocktake.appliedAt) {
        throw new HttpError(409, 'Stocktake has already been applied');
      }

      const appliedAt = new Date();
      const applied = await tx.stocktake.updateMany({
        where: { id, status: 'SUBMITTED', appliedAt: null },
        data: {
          appliedAt,
          reviewedAt: appliedAt,
          reviewedByUserId: reviewer?.id ?? null
        }
      });
      if (applied.count !== 1) {
        throw new HttpError(409, 'Stocktake has already been applied');
      }

      const movements: InventoryMovementRow[] = [];
      for (const line of stocktake.lines) {
        if (!line.itemId) continue;
        const balanceTarget = await balanceTargetForItem(tx, line.itemId, stocktake.venue);
        if (!balanceTarget) continue;

        const quantityBefore = balanceTarget.quantityBefore;
        const quantityAfter = line.countedQty;
        const quantityDelta = quantityAfter - quantityBefore;

        const movement = await tx.inventoryMovement.create({
          data: {
            itemId: balanceTarget.item.id,
            movementType: 'STOCKTAKE_ADJUSTMENT',
            quantityDelta,
            quantityBefore,
            quantityAfter,
            unit: line.unit ?? balanceTarget.item.unit,
            sourceStocktakeId: stocktake.id,
            sourceStocktakeLineId: line.id,
            notes: notesWithContext([
              `Applied stocktake: ${stocktake.name}`,
              stocktake.venue ? `Venue: ${stocktake.venue}` : null,
              line.location ? `Location: ${line.location}` : null,
              reviewedBy ? `Reviewed by: ${reviewedBy}` : null
            ])
          }
        });
        movements.push(movement);

        await balanceTarget.updateQuantityAfter(quantityAfter);
      }

      const appliedStocktake = await tx.stocktake.findUniqueOrThrow({
        where: { id },
        include: {
          lines: {
            include: { item: { select: { id: true, name: true, unit: true, onHand: true } } }
          }
        }
      });

      return { stocktake: appliedStocktake, movements };
    }, { maxWait: 15_000, timeout: 30_000 });

    return {
      stocktake: await loadStocktakeWithVenueOnHand(result.stocktake.id, reviewer),
      movements: result.movements.map(toMovementPayload)
    };
  },

  async getMovementHistory(
    id: string,
    actor?: AuthUser | null
  ): Promise<StocktakeMovementHistoryPayload> {
    const stocktake = await prisma.stocktake.findFirst({
      where: scopedStocktakeWhere(id, actor),
      include: {
        _count: { select: { lines: true } },
        lines: { select: { stockValueCents: true } }
      }
    });
    if (!stocktake) throw new HttpError(404, 'Stocktake not found');

    const movements = await prisma.inventoryMovement.findMany({
      where: { sourceStocktakeId: id },
      include: {
        item: { select: { id: true, name: true, unit: true, onHand: true } },
        sourceStocktakeLine: {
          select: { id: true, label: true, countedQty: true, unit: true, location: true }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    const hasReversal = movements.some(
      (movement) =>
        movement.movementType === 'STOCKTAKE_REVERSAL' &&
        (!stocktake.appliedAt || movement.createdAt >= stocktake.appliedAt)
    );

    return {
      stocktake: toStocktakePayload(stocktake),
      movements: movements.map(toMovementWithContextPayload),
      canReverse: Boolean(stocktake.appliedAt && !hasReversal),
      hasReversal
    };
  },

  async createCorrection(
    id: string,
    input: unknown,
    reviewer?: AuthUser | null
  ): Promise<StocktakeMovementResult> {
    const data = stocktakeCorrectionInputSchema.parse(input);
    const reviewedBy = reviewerLabel(reviewer);

    const result = await prisma.$transaction(async (tx) => {
      const stocktake = await tx.stocktake.findFirst({
        where: scopedStocktakeWhere(id, reviewer),
        include: {
          lines: {
            include: { item: { select: { id: true, name: true, unit: true, onHand: true } } }
          }
        }
      });

      if (!stocktake) throw new HttpError(404, 'Stocktake not found');
      if (!stocktake.appliedAt) {
        throw new HttpError(409, 'Only applied stocktakes can be corrected');
      }

      const hasReversal = await tx.inventoryMovement.count({
        where: reversalSinceAppliedWhere(id, stocktake.appliedAt)
      });
      if (hasReversal) {
        throw new HttpError(409, 'Reversed stocktakes must be edited and resubmitted instead of corrected');
      }

      const linesById = new Map(stocktake.lines.map((line) => [line.id, line]));
      const movements: InventoryMovementWithContextRow[] = [];

      for (const correction of data.corrections) {
        const line = linesById.get(correction.sourceStocktakeLineId);
        if (!line || !line.itemId) {
          throw new HttpError(400, 'Correction line must be linked to a stock item');
        }

        const balanceTarget = await balanceTargetForItem(tx, line.itemId, stocktake.venue);
        if (!balanceTarget) throw new HttpError(404, `Stock item not found for ${line.label}`);

        const quantityBefore = balanceTarget.quantityBefore;
        const quantityAfter = correction.quantityAfter;
        const quantityDelta = quantityAfter - quantityBefore;
        if (Math.abs(quantityDelta) <= 0.0001) continue;

        const movement = await tx.inventoryMovement.create({
          data: {
            itemId: balanceTarget.item.id,
            movementType: 'STOCKTAKE_CORRECTION',
            quantityDelta,
            quantityBefore,
            quantityAfter,
            unit: line.unit ?? balanceTarget.item.unit,
            sourceStocktakeId: stocktake.id,
            sourceStocktakeLineId: line.id,
            notes: notesWithContext([
              `Correction for stocktake: ${stocktake.name}`,
              stocktake.venue ? `Venue: ${stocktake.venue}` : null,
              line.location ? `Location: ${line.location}` : null,
              `Reason: ${correction.reason.trim()}`,
              reviewedBy ? `Reviewed by: ${reviewedBy}` : null
            ])
          },
          include: {
            item: { select: { id: true, name: true, unit: true, onHand: true } },
            sourceStocktakeLine: {
              select: { id: true, label: true, countedQty: true, unit: true, location: true }
            }
          }
        });
        movements.push(movement);

        await balanceTarget.updateQuantityAfter(quantityAfter);
      }

      if (movements.length === 0) {
        throw new HttpError(400, 'Correction does not change any balances');
      }

      const updatedStocktake = await tx.stocktake.findUniqueOrThrow({
        where: { id },
        include: {
          lines: {
            include: { item: { select: { id: true, name: true, unit: true, onHand: true } } }
          }
        }
      });

      return { stocktake: updatedStocktake, movements };
    }, { maxWait: 15_000, timeout: 30_000 });

    return {
      stocktake: await loadStocktakeWithVenueOnHand(result.stocktake.id, reviewer),
      movements: result.movements.map(toMovementWithContextPayload)
    };
  },

  async reverseStocktake(
    id: string,
    input: unknown,
    reviewer?: AuthUser | null
  ): Promise<StocktakeMovementResult> {
    const data = stocktakeReversalInputSchema.parse(input);
    const reviewedBy = reviewerLabel(reviewer);
    const reason = data.reason?.trim() || 'Manager reversal';

    const result = await prisma.$transaction(async (tx) => {
      const stocktake = await tx.stocktake.findFirst({ where: scopedStocktakeWhere(id, reviewer) });
      if (!stocktake) throw new HttpError(404, 'Stocktake not found');
      if (!stocktake.appliedAt) {
        throw new HttpError(409, 'Only applied stocktakes can be reversed');
      }

      const existingReversal = await tx.inventoryMovement.count({
        where: reversalSinceAppliedWhere(id, stocktake.appliedAt)
      });
      if (existingReversal) {
        throw new HttpError(409, 'Stocktake has already been reversed');
      }

      const sourceMovements = await tx.inventoryMovement.findMany({
        where: {
          sourceStocktakeId: id,
          movementType: { in: ['STOCKTAKE_ADJUSTMENT', 'STOCKTAKE_CORRECTION'] },
          createdAt: { gte: stocktake.appliedAt }
        },
        orderBy: { createdAt: 'asc' }
      });

      if (sourceMovements.length === 0) {
        throw new HttpError(409, 'No stocktake ledger movements exist to reverse');
      }

      const netByLine = new Map<
        string,
        { itemId: string; sourceStocktakeLineId: string | null; unit: string | null; quantityDelta: number }
      >();
      for (const movement of sourceMovements) {
        const key = `${movement.itemId}:${movement.sourceStocktakeLineId ?? 'stocktake'}`;
        const current = netByLine.get(key) ?? {
          itemId: movement.itemId,
          sourceStocktakeLineId: movement.sourceStocktakeLineId,
          unit: movement.unit,
          quantityDelta: 0
        };
        current.quantityDelta += movement.quantityDelta;
        current.unit = movement.unit ?? current.unit;
        netByLine.set(key, current);
      }

      const movements: InventoryMovementWithContextRow[] = [];
      for (const group of netByLine.values()) {
        if (Math.abs(group.quantityDelta) <= 0.0001) continue;
        const balanceTarget = await balanceTargetForItem(tx, group.itemId, stocktake.venue);
        if (!balanceTarget) continue;

        const quantityBefore = balanceTarget.quantityBefore;
        const quantityDelta = -group.quantityDelta;
        const quantityAfter = quantityBefore + quantityDelta;

        const movement = await tx.inventoryMovement.create({
          data: {
            itemId: balanceTarget.item.id,
            movementType: 'STOCKTAKE_REVERSAL',
            quantityDelta,
            quantityBefore,
            quantityAfter,
            unit: group.unit ?? balanceTarget.item.unit,
            sourceStocktakeId: stocktake.id,
            sourceStocktakeLineId: group.sourceStocktakeLineId,
            notes: notesWithContext([
              `Reversal for stocktake: ${stocktake.name}`,
              stocktake.venue ? `Venue: ${stocktake.venue}` : null,
              `Reason: ${reason}`,
              reviewedBy ? `Reviewed by: ${reviewedBy}` : null
            ])
          },
          include: {
            item: { select: { id: true, name: true, unit: true, onHand: true } },
            sourceStocktakeLine: {
              select: { id: true, label: true, countedQty: true, unit: true, location: true }
            }
          }
        });
        movements.push(movement);

        await balanceTarget.updateQuantityAfter(quantityAfter);
      }

      if (movements.length === 0) {
        throw new HttpError(409, 'Stocktake movements already net to zero');
      }

      const updatedStocktake = await tx.stocktake.update({
        where: { id },
        data: { appliedAt: null, status: 'IN_PROGRESS' },
        include: {
          lines: {
            include: { item: { select: { id: true, name: true, unit: true, onHand: true } } }
          }
        }
      });

      return { stocktake: updatedStocktake, movements };
    }, { maxWait: 15_000, timeout: 30_000 });

    return {
      stocktake: await loadStocktakeWithVenueOnHand(result.stocktake.id, reviewer),
      movements: result.movements.map(toMovementWithContextPayload)
    };
  },

  async reviewQueue(actor?: AuthUser | null): Promise<{ stocktakes: StocktakeReviewItem[] }> {
    const rows = await prisma.stocktake.findMany({
      where: { AND: [stocktakeScope(actor), { status: 'SUBMITTED', appliedAt: null }] },
      include: {
        _count: { select: { lines: true } },
        lines: {
          select: {
            countedQty: true,
            stockValueCents: true,
            unit: true,
            item: { select: { id: true, onHand: true } }
          }
        }
      },
      orderBy: [{ submittedAt: 'desc' }, { updatedAt: 'desc' }],
      take: 50
    });
    const venueOnHandByKey = await venueOnHandLookup(rows);
    return { stocktakes: rows.map((row) => toStocktakeReviewPayload(row, venueOnHandByKey)) };
  },

  async reopenStocktake(id: string, actor?: AuthUser | null): Promise<Stocktake> {
    const existing = await prisma.stocktake.findFirst({
      where: scopedStocktakeWhere(id, actor),
      include: {
        _count: { select: { lines: true } },
        lines: { select: { stockValueCents: true } }
      }
    });
    if (!existing) throw new HttpError(404, 'Stocktake not found');
    if (existing.appliedAt) {
      throw new HttpError(409, 'Applied stocktakes must be reversed before reopening.');
    }
    if (existing.status !== 'SUBMITTED') {
      throw new HttpError(400, 'Only submitted stocktakes can be reopened.');
    }

    const row = await prisma.stocktake.update({
      where: { id },
      data: {
        status: 'IN_PROGRESS',
        submittedAt: null,
        submittedByUserId: null,
        reviewedAt: new Date(),
        reviewedByUserId: actor?.id ?? null
      },
      include: {
        _count: { select: { lines: true } },
        lines: { select: { stockValueCents: true } }
      }
    });
    return toStocktakePayload(row);
  },

  async deleteStocktakes(input: unknown, actor?: AuthUser | null): Promise<{ deleted: number }> {
    const { ids } = stocktakeBulkDeleteInputSchema.parse(input);
    const uniqueIds = Array.from(new Set(ids));
    const visible = await prisma.stocktake.findMany({
      where: { AND: [stocktakeScope(actor), { id: { in: uniqueIds } }] },
      select: { id: true }
    });
    if (visible.length !== uniqueIds.length) {
      throw new HttpError(403, 'Stocktake deletion is limited to your venue.');
    }

    const applied = await prisma.stocktake.findMany({
      where: { AND: [stocktakeScope(actor), { id: { in: uniqueIds }, appliedAt: { not: null } }] },
      select: { id: true, name: true, appliedAt: true }
    });
    const blocked: string[] = [];
    for (const stocktake of applied) {
      const hasReversal = await prisma.inventoryMovement.count({
        where: reversalSinceAppliedWhere(stocktake.id, stocktake.appliedAt)
      });
      if (!hasReversal) blocked.push(stocktake.name);
    }
    if (blocked.length > 0) {
      throw new HttpError(
        409,
        `Applied stocktakes cannot be deleted without a reversal: ${blocked.join(', ')}`
      );
    }
    const result = await prisma.stocktake.deleteMany({
      where: { AND: [stocktakeScope(actor), { id: { in: uniqueIds } }] }
    });
    return { deleted: result.count };
  },

  // ──────────────────────────────────────────────────────────────
  // Stocktake state machine (Loaded replacement Sprint 1)
  //
  // IN_PROGRESS → SUBMITTED → REVIEWED → LOCKED. LOCKED can be
  // REOPENED back to IN_PROGRESS with a reason. Once LOCKED, reports
  // prefer this stocktake when computing stock value + COGS.
  // ──────────────────────────────────────────────────────────────

  async submitStocktake(id: string, actor?: AuthUser | null): Promise<Stocktake> {
    const existing = await prisma.stocktake.findFirst({ where: scopedStocktakeWhere(id, actor) });
    if (!existing) throw new HttpError(404, 'Stocktake not found');
    if (existing.status !== 'IN_PROGRESS') {
      throw new HttpError(409, `Stocktake is ${existing.status}, only IN_PROGRESS draft stocktakes can be submitted.`);
    }
    const row = await prisma.stocktake.update({
      where: { id },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        submittedByUserId: actor?.id ?? null
      },
      include: {
        _count: { select: { lines: true } },
        lines: { select: { stockValueCents: true } }
      }
    });
    return toStocktakePayload(row);
  },

  async reviewStocktake(id: string, actor: AuthUser | undefined | null, input: { notes?: string }): Promise<Stocktake> {
    const existing = await prisma.stocktake.findFirst({ where: scopedStocktakeWhere(id, actor) });
    if (!existing) throw new HttpError(404, 'Stocktake not found');
    if (existing.status !== 'SUBMITTED') {
      throw new HttpError(409, `Stocktake is ${existing.status}, only SUBMITTED stocktakes can be reviewed.`);
    }
    const row = await prisma.stocktake.update({
      where: { id },
      data: {
        status: 'REVIEWED',
        reviewedAt: new Date(),
        reviewedByUserId: actor?.id ?? null,
        ...(input.notes ? { notes: existing.notes ? `${existing.notes}\n\nReviewer: ${input.notes.trim()}` : `Reviewer: ${input.notes.trim()}` } : {})
      },
      include: {
        _count: { select: { lines: true } },
        lines: { select: { stockValueCents: true } }
      }
    });
    return toStocktakePayload(row);
  },

  async lockStocktake(id: string, actor?: AuthUser | null): Promise<Stocktake> {
    const existing = await prisma.stocktake.findFirst({ where: scopedStocktakeWhere(id, actor) });
    if (!existing) throw new HttpError(404, 'Stocktake not found');
    if (!['REVIEWED', 'SUBMITTED'].includes(existing.status)) {
      throw new HttpError(409, `Stocktake is ${existing.status}, only REVIEWED or SUBMITTED stocktakes can be locked.`);
    }
    const row = await prisma.stocktake.update({
      where: { id },
      data: {
        status: 'LOCKED',
        lockedAt: new Date(),
        lockedByUserId: actor?.id ?? null
      },
      include: {
        _count: { select: { lines: true } },
        lines: { select: { stockValueCents: true } }
      }
    });
    return toStocktakePayload(row);
  },

  async reopenStocktakeWithReason(id: string, actor: AuthUser | undefined | null, reason: string): Promise<Stocktake> {
    const existing = await prisma.stocktake.findFirst({ where: scopedStocktakeWhere(id, actor) });
    if (!existing) throw new HttpError(404, 'Stocktake not found');
    if (!['SUBMITTED', 'REVIEWED', 'LOCKED'].includes(existing.status)) {
      throw new HttpError(409, `Stocktake is ${existing.status}, only SUBMITTED / REVIEWED / LOCKED stocktakes can be reopened.`);
    }
    if (!reason || reason.trim().length < 5) {
      throw new HttpError(400, 'Reopen requires a reason of at least 5 characters — it goes into the audit log.');
    }
    const row = await prisma.stocktake.update({
      where: { id },
      data: {
        status: 'REOPENED',
        reopenedAt: new Date(),
        reopenedByUserId: actor?.id ?? null,
        reopenReason: reason.trim()
      },
      include: {
        _count: { select: { lines: true } },
        lines: { select: { stockValueCents: true } }
      }
    });
    return toStocktakePayload(row);
  },

  // Variance review (#9). Compares the target stocktake to the previous
  // LOCKED stocktake at the same venue. Returns line-level deltas + a
  // categorised summary so the manager can spot the worst movers fast.
  async varianceReport(id: string, actor?: AuthUser | null) {
    const target = await prisma.stocktake.findFirst({
      where: scopedStocktakeWhere(id, actor),
      include: {
        lines: { include: { item: { include: { category: true } } } }
      }
    });
    if (!target) throw new HttpError(404, 'Stocktake not found');

    // Find the previous LOCKED stocktake at the same venue, before this one.
    const previous = await prisma.stocktake.findFirst({
      where: {
        ...(target.venue ? { venue: target.venue } : {}),
        status: 'LOCKED',
        id: { not: target.id },
        countedAt: { lt: target.countedAt }
      },
      orderBy: [{ countedAt: 'desc' }],
      include: { lines: true }
    });

    const previousByItemId = new Map<string, { qty: number; valueCents: number | null }>();
    if (previous) {
      for (const line of previous.lines) {
        if (!line.itemId) continue;
        previousByItemId.set(line.itemId, {
          qty: line.countedQty,
          valueCents: line.stockValueCents
        });
      }
    }

    const HIGH_VARIANCE_THRESHOLD = 0.2; // ±20% qty change flags as high
    let highVarianceCount = 0;
    let missingCount = 0;
    let zeroCount = 0;
    let newItemCount = 0;

    const rows = target.lines.map((line) => {
      const prev = line.itemId ? previousByItemId.get(line.itemId) : undefined;
      const varianceQty = prev !== undefined ? line.countedQty - prev.qty : null;
      const varianceValueCents = prev !== undefined && prev.valueCents !== null && line.stockValueCents !== null
        ? line.stockValueCents - prev.valueCents
        : null;
      const variancePct = prev !== undefined && prev.qty > 0
        ? (line.countedQty - prev.qty) / prev.qty
        : null;

      const isMissing = line.countedQty === null || Number.isNaN(line.countedQty);
      const isZero = line.countedQty === 0;
      const isNew = prev === undefined && line.itemId !== null;
      const isHighVariance = variancePct !== null && Math.abs(variancePct) > HIGH_VARIANCE_THRESHOLD;

      if (isMissing) missingCount += 1;
      else if (isZero) zeroCount += 1;
      if (isHighVariance) highVarianceCount += 1;
      if (isNew) newItemCount += 1;

      return {
        lineId: line.id,
        itemId: line.itemId,
        label: line.label,
        category: line.item?.category?.name ?? null,
        countArea: line.location ?? line.item?.countArea ?? null,
        unit: line.unit ?? line.item?.countUnit ?? line.item?.unit ?? null,
        currentQty: line.countedQty,
        previousQty: prev?.qty ?? null,
        varianceQty,
        variancePct,
        currentValueCents: line.stockValueCents,
        previousValueCents: prev?.valueCents ?? null,
        varianceValueCents,
        flags: {
          missing: isMissing,
          zero: isZero,
          newItem: isNew,
          highVariance: isHighVariance
        },
        latestCostCents: line.item?.latestCostCents ?? line.item?.avgCostCents ?? null
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      stocktakeId: target.id,
      stocktakeName: target.name,
      stocktakeStatus: target.status,
      countedAt: target.countedAt.toISOString(),
      previousLocked: previous
        ? { id: previous.id, name: previous.name, countedAt: previous.countedAt.toISOString() }
        : null,
      summary: {
        totalLines: rows.length,
        highVariance: highVarianceCount,
        missing: missingCount,
        zero: zeroCount,
        newItems: newItemCount,
        highVarianceThresholdPct: HIGH_VARIANCE_THRESHOLD * 100
      },
      // Worst variances first so the manager sees the most surprising lines.
      rows: rows.sort((a, b) => {
        const av = a.varianceValueCents === null ? 0 : Math.abs(a.varianceValueCents);
        const bv = b.varianceValueCents === null ? 0 : Math.abs(b.varianceValueCents);
        return bv - av;
      })
    };
  },

  // CSV export — drops the stocktake into a one-row-per-line CSV.
  // Used by the Loaded replacement archive flow + ad-hoc downloads.
  async exportCsv(id: string, actor?: AuthUser | null): Promise<{ filename: string; csv: string }> {
    const existing = await prisma.stocktake.findFirst({
      where: scopedStocktakeWhere(id, actor),
      include: {
        lines: {
          include: { item: { include: { category: true } } },
          orderBy: [{ position: 'asc' }]
        }
      }
    });
    if (!existing) throw new HttpError(404, 'Stocktake not found');

    function csvCell(value: unknown): string {
      const text = value == null ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    const headers = [
      'stocktake_id', 'name', 'venue', 'status', 'counted_at',
      'area', 'category', 'item', 'sku', 'quantity', 'unit',
      'latest_cost_cents', 'stock_value_cents', 'notes'
    ];
    const rows = existing.lines.map((line) => ({
      stocktake_id: existing.id,
      name: existing.name,
      venue: existing.venue ?? '',
      status: existing.status,
      counted_at: existing.countedAt?.toISOString().slice(0, 10) ?? '',
      area: line.location ?? line.item?.countArea ?? '',
      category: line.item?.category?.name ?? '',
      item: line.label,
      sku: line.item?.sku ?? '',
      quantity: line.countedQty,
      unit: line.unit ?? line.item?.countUnit ?? line.item?.unit ?? '',
      latest_cost_cents: line.item?.latestCostCents ?? line.item?.avgCostCents ?? '',
      stock_value_cents: line.stockValueCents ?? '',
      notes: line.notes ?? ''
    }));

    const csv = [headers, ...rows.map((row) => headers.map((header) => csvCell((row as Record<string, unknown>)[header])))]
      .map((row) => row.map((cell) => (typeof cell === 'string' ? cell : csvCell(cell))).join(','))
      .join('\n');

    return {
      filename: `alma-stocktake-${existing.name.replace(/\s+/g, '-').toLowerCase()}-${existing.id}.csv`,
      csv
    };
  }
};
