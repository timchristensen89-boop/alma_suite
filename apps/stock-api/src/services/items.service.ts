import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import {
  stockCategoryCreateInputSchema,
  stockCategoryUpdateInputSchema,
  stockItemBulkDeleteInputSchema,
  stockItemCreateInputSchema,
  stockItemUpdateInputSchema,
  venueStockItemUpdateInputSchema,
  type StockCategory,
  type StockDashboardPayload,
  type StockItem,
  type StockItemsPayload,
  type StockItemsSummary,
  type StockLowStockItem,
  type StocktakeReviewItem,
  type VenueStockItem,
  type AuthUser
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

type StockItemRow = Prisma.StockItemGetPayload<{
  include: { category: { select: { id: true; name: true } } };
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

type VenueStockItemRow = Prisma.VenueStockItemGetPayload<{
  include: {
    stockItem: { include: { category: { select: { id: true; name: true } } } };
  };
}>;

function normaliseOptionalText(value: string | undefined) {
  if (value === undefined) return undefined;
  return value.trim() || null;
}

function normaliseOptionalNumber(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return undefined;
  return value;
}

function assertNoDirectOnHandMutation(input: unknown) {
  if (input && typeof input === 'object' && 'onHand' in input) {
    throw new HttpError(400, 'Stock on hand can only be changed by inventory movements');
  }
}

function toCategoryPayload(row: {
  id: string;
  legacyId: string | null;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StockCategory {
  return {
    id: row.id,
    legacyId: row.legacyId,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toItemPayload(row: StockItemRow): StockItem {
  return {
    id: row.id,
    legacyId: row.legacyId,
    sku: row.sku,
    name: row.name,
    categoryId: row.categoryId,
    category: row.category,
    unit: row.unit,
    onHand: row.onHand,
    parLevel: row.parLevel,
    reorderPoint: row.reorderPoint,
    avgCostCents: row.avgCostCents,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toVenueStockPayload(row: VenueStockItemRow): VenueStockItem {
  return {
    id: row.id,
    venue: row.venue,
    stockItemId: row.stockItemId,
    parLevel: row.parLevel,
    reorderPoint: row.reorderPoint,
    onHand: row.onHand,
    unitOverride: row.unitOverride,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    stockItem: {
      id: row.stockItem.id,
      sku: row.stockItem.sku,
      name: row.stockItem.name,
      unit: row.stockItem.unit,
      category: row.stockItem.category,
      status: row.stockItem.status,
      avgCostCents: row.stockItem.avgCostCents,
      parLevel: row.stockItem.parLevel,
      reorderPoint: row.stockItem.reorderPoint
    }
  };
}

function isAdminActor(actor?: AuthUser | null) {
  return Boolean(actor?.isAdmin || actor?.role === 'ADMIN');
}

function actorVenueScope(actor?: AuthUser | null, requestedVenue?: string | null) {
  const venue = requestedVenue?.trim() || null;
  if (!actor || isAdminActor(actor)) return venue;
  if (!actor.venue) throw new HttpError(403, 'Stock access requires a venue-scoped staff profile.');
  if (venue && venue !== actor.venue) {
    throw new HttpError(403, 'Stock access is limited to your venue.');
  }
  return actor.venue;
}

function stocktakeScope(actor?: AuthUser | null, requestedVenue?: string | null): Prisma.StocktakeWhereInput {
  const venue = actorVenueScope(actor, requestedVenue);
  return venue ? { venue } : {};
}

function venueStockWhere(actor?: AuthUser | null, requestedVenue?: string | null): Prisma.VenueStockItemWhereInput {
  const venue = actorVenueScope(actor, requestedVenue);
  return {
    ...(venue ? { venue } : {}),
    active: true,
    stockItem: { status: 'ACTIVE' }
  };
}

function scopedVenueStockWhere(actor?: AuthUser | null, requestedVenue?: string | null): Prisma.VenueStockItemWhereInput {
  const venue = actorVenueScope(actor, requestedVenue);
  return {
    ...(venue ? { venue } : {})
  };
}

function effectiveThreshold(row: VenueStockItemRow) {
  return row.reorderPoint ?? row.parLevel ?? row.stockItem.reorderPoint ?? row.stockItem.parLevel;
}

function effectiveParLevel(row: VenueStockItemRow) {
  return row.parLevel ?? row.stockItem.parLevel;
}

function effectiveReorderPoint(row: VenueStockItemRow) {
  return row.reorderPoint ?? row.stockItem.reorderPoint;
}

function lowStockStatus(row: Pick<VenueStockItemRow, 'onHand'> & { reorderPoint: number | null; parLevel: number | null }) {
  if ((row.onHand ?? 0) <= 0) {
    return { stockStatus: 'OUT_OF_STOCK' as const, suggestedAction: 'Out of stock' };
  }
  if (row.reorderPoint !== null && row.reorderPoint > 0 && (row.onHand ?? 0) <= row.reorderPoint) {
    return { stockStatus: 'LOW_STOCK' as const, suggestedAction: 'Order soon' };
  }
  return { stockStatus: 'BELOW_PAR' as const, suggestedAction: 'Below par' };
}

function isLowVenueStockRow(row: VenueStockItemRow) {
  const threshold = effectiveThreshold(row);
  return row.active && row.stockItem.status === 'ACTIVE' && row.onHand !== null && threshold > 0 && row.onHand <= threshold;
}

function toLowStockPayload(row: VenueStockItemRow): StockLowStockItem {
  const threshold = effectiveThreshold(row);
  const parLevel = effectiveParLevel(row);
  const reorderPoint = effectiveReorderPoint(row);
  return {
    id: row.stockItem.id,
    venueStockItemId: row.id,
    venue: row.venue,
    sku: row.stockItem.sku,
    name: row.stockItem.name,
    category: row.stockItem.category,
    unit: row.unitOverride ?? row.stockItem.unit,
    onHand: row.onHand,
    parLevel,
    reorderPoint,
    status: row.stockItem.status,
    updatedAt: row.updatedAt.toISOString(),
    threshold,
    ...lowStockStatus({ onHand: row.onHand, parLevel, reorderPoint })
  };
}

function stocktakeLineValue(lines: StocktakeReviewRow['lines']) {
  return lines.reduce((sum, line) => sum + (line.stockValueCents ?? 0), 0);
}

async function venueOnHandLookup(
  rows: Array<{ venue: string | null; lines: Array<{ item: { id: string } | null }> }>
) {
  const venues = Array.from(
    new Set(rows.map((row) => row.venue?.trim()).filter((venue): venue is string => Boolean(venue)))
  );
  const itemIds = Array.from(
    new Set(
      rows.flatMap((row) =>
        row.lines.flatMap((line) => (line.item?.id ? [line.item.id] : []))
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

function currentOnHandForReviewLine(
  row: StocktakeReviewRow,
  line: StocktakeReviewRow['lines'][number],
  venueOnHandByKey?: Map<string, number | null>
) {
  if (!line.item) return null;
  if (!row.venue) return line.item.onHand;
  const venueOnHand = venueOnHandByKey?.get(`${row.venue}:${line.item.id}`);
  return venueOnHand ?? line.item.onHand;
}

function toStocktakeReviewPayload(
  row: StocktakeReviewRow,
  venueOnHandByKey?: Map<string, number | null>
): StocktakeReviewItem {
  const variance = row.lines.reduce(
    (summary, line) => {
      const onHand = currentOnHandForReviewLine(row, line, venueOnHandByKey);
      if (onHand === null) return summary;
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
    totalValueCents: stocktakeLineValue(row.lines),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...variance
  };
}

async function assertCategoryExists(categoryId: string | null | undefined) {
  if (!categoryId) return;
  const category = await prisma.stockCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw new HttpError(400, 'Category not found');
}

async function venueOptions(actor?: AuthUser | null) {
  if (actor && !isAdminActor(actor)) {
    return actor.venue ? [actor.venue] : [];
  }

  const [venueRows, venueStockRows, stocktakeRows, staffRows] = await Promise.all([
    prisma.venue.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
    prisma.venueStockItem.findMany({ distinct: ['venue'], select: { venue: true }, orderBy: { venue: 'asc' } }),
    prisma.stocktake.findMany({
      where: { venue: { not: null } },
      distinct: ['venue'],
      select: { venue: true },
      orderBy: { venue: 'asc' }
    }),
    prisma.staffProfile.findMany({
      where: { venue: { not: null }, employmentStatus: { not: 'ARCHIVED' } },
      distinct: ['venue'],
      select: { venue: true },
      orderBy: { venue: 'asc' }
    })
  ]);

  return Array.from(
    new Set(
      [
        ...venueRows.map((row) => row.name?.trim()),
        ...venueStockRows.map((row) => row.venue?.trim()),
        ...stocktakeRows.map((row) => row.venue?.trim()),
        ...staffRows.map((row) => row.venue?.trim())
      ].filter((venue): venue is string => Boolean(venue))
    )
  ).sort((a, b) => a.localeCompare(b));
}

async function assertKnownVenue(venue: string, actor?: AuthUser | null) {
  const venues = await venueOptions(actor);
  if (!venues.includes(venue)) {
    throw new HttpError(404, 'Venue not found');
  }
}

export const itemsService = {
  async list(actor?: AuthUser | null, requestedVenue?: string | null): Promise<StockItemsPayload> {
    const venue = actorVenueScope(actor, requestedVenue);
    const [items, categories, venueStockItems, venues] = await Promise.all([
      prisma.stockItem.findMany({
        include: { category: { select: { id: true, name: true } } },
        orderBy: [{ status: 'asc' }, { name: 'asc' }]
      }),
      prisma.stockCategory.findMany({
        orderBy: { name: 'asc' }
      }),
      prisma.venueStockItem.findMany({
        where: scopedVenueStockWhere(actor, requestedVenue),
        include: { stockItem: { include: { category: { select: { id: true, name: true } } } } },
        orderBy: [{ venue: 'asc' }, { updatedAt: 'desc' }]
      }),
      venueOptions(actor)
    ]);
    const scopedVenueStockByItemId = venue
      ? new Map(venueStockItems.filter((row) => row.venue === venue).map((row) => [row.stockItemId, row]))
      : new Map<string, VenueStockItemRow>();

    return {
      items: items.map((item) => {
        const payload = toItemPayload(item);
        const venueStock = scopedVenueStockByItemId.get(item.id);
        return venueStock ? { ...payload, venueStock: toVenueStockPayload(venueStock) } : payload;
      }),
      categories: categories.map(toCategoryPayload),
      venueStockItems: venueStockItems.map(toVenueStockPayload),
      venues,
      scope: {
        venue,
        admin: isAdminActor(actor),
        stockItemsVenueScoped: true
      }
    };
  },

  async summary(actor?: AuthUser | null, requestedVenue?: string | null): Promise<StockItemsSummary> {
    const venue = actorVenueScope(actor, requestedVenue);
    const [totalItems, activeItems, categories, venueRows] = await Promise.all([
      prisma.stockItem.count(),
      prisma.stockItem.count({ where: { status: 'ACTIVE' } }),
      prisma.stockCategory.count(),
      prisma.venueStockItem.findMany({
        where: venueStockWhere(actor, requestedVenue),
        include: { stockItem: { include: { category: { select: { id: true, name: true } } } } }
      })
    ]);

    const trackedItemIds = new Set(venueRows.map((row) => row.stockItemId));
    const lowStockItems = venueRows.filter(isLowVenueStockRow).length;
    const outOfStockItems = venueRows.filter((row) => row.onHand !== null && row.onHand <= 0).length;
    const totalOnHand = venueRows.reduce((total, row) => total + (row.onHand ?? 0), 0);

    return {
      totalItems,
      activeItems,
      lowStockItems,
      outOfStockItems,
      categories,
      totalOnHand,
      venueStockItems: trackedItemIds.size,
      unconfiguredVenueStockItems: venue ? Math.max(activeItems - trackedItemIds.size, 0) : 0,
      stockItemsVenueScoped: true
    };
  },

  async lowStock(actor?: AuthUser | null, requestedVenue?: string | null): Promise<{ items: StockLowStockItem[] }> {
    const rows = await prisma.venueStockItem.findMany({
      where: venueStockWhere(actor, requestedVenue),
      include: { stockItem: { include: { category: { select: { id: true, name: true } } } } },
      orderBy: [{ updatedAt: 'desc' }, { stockItem: { name: 'asc' } }],
      take: 200
    });
    return { items: rows.filter(isLowVenueStockRow).map(toLowStockPayload) };
  },

  async dashboard(actor?: AuthUser | null, requestedVenue?: string | null): Promise<StockDashboardPayload> {
    const venue = actorVenueScope(actor, requestedVenue);
    const stocktakeWhere = stocktakeScope(actor, requestedVenue);
    const [
      summary,
      lowStockRows,
      recentItems,
      venues,
      openStocktakes,
      readyForReviewCount,
      readyForReviewStocktakes,
      recentSubmittedStocktakes
    ] = await Promise.all([
      itemsService.summary(actor, requestedVenue),
      prisma.venueStockItem.findMany({
        where: venueStockWhere(actor, requestedVenue),
        include: { stockItem: { include: { category: { select: { id: true, name: true } } } } },
        orderBy: [{ updatedAt: 'desc' }, { stockItem: { name: 'asc' } }],
        take: 200
      }),
      prisma.stockItem.findMany({
        include: { category: { select: { id: true, name: true } } },
        orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
        take: 8
      }),
      venueOptions(actor),
      prisma.stocktake.count({
        where: { AND: [stocktakeWhere, { status: 'IN_PROGRESS', appliedAt: null }] }
      }),
      prisma.stocktake.count({
        where: { AND: [stocktakeWhere, { status: 'SUBMITTED', appliedAt: null }] }
      }),
      prisma.stocktake.findMany({
        where: { AND: [stocktakeWhere, { status: 'SUBMITTED', appliedAt: null }] },
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
        take: 6
      }),
      prisma.stocktake.findMany({
        where: { AND: [stocktakeWhere, { status: 'SUBMITTED' }] },
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
        take: 6
      })
    ]);

    const lowStockItems = lowStockRows.filter(isLowVenueStockRow).map(toLowStockPayload).slice(0, 10);
    const venueOnHandByKey = await venueOnHandLookup([
      ...readyForReviewStocktakes,
      ...recentSubmittedStocktakes
    ]);
    const readyForReview = readyForReviewStocktakes.map((row) =>
      toStocktakeReviewPayload(row, venueOnHandByKey)
    );

    return {
      generatedAt: new Date().toISOString(),
      scope: {
        venue,
        admin: isAdminActor(actor),
        stockItemsVenueScoped: true
      },
      venues,
      summary: {
        ...summary,
        openStocktakes,
        readyForReviewStocktakes: readyForReviewCount
      },
      lowStockItems,
      recentItems: recentItems.map(toItemPayload),
      readyForReviewStocktakes: readyForReview,
      recentSubmittedStocktakes: recentSubmittedStocktakes.map((row) =>
        toStocktakeReviewPayload(row, venueOnHandByKey)
      )
    };
  },

  async createCategory(input: unknown): Promise<StockCategory> {
    const data = stockCategoryCreateInputSchema.parse(input);
    const existing = await prisma.stockCategory.findUnique({
      where: { name: data.name.trim() }
    });
    if (existing) throw new HttpError(409, 'A category with that name already exists');

    const row = await prisma.stockCategory.create({
      data: {
        name: data.name.trim(),
        description: normaliseOptionalText(data.description) ?? null
      }
    });
    return toCategoryPayload(row);
  },

  async updateCategory(id: string, input: unknown): Promise<StockCategory> {
    const data = stockCategoryUpdateInputSchema.parse(input);
    const existing = await prisma.stockCategory.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Category not found');

    const name = data.name !== undefined ? data.name.trim() : undefined;
    if (name && name !== existing.name) {
      const conflict = await prisma.stockCategory.findUnique({ where: { name } });
      if (conflict) throw new HttpError(409, 'A category with that name already exists');
    }

    const row = await prisma.stockCategory.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(data.description !== undefined && {
          description: normaliseOptionalText(data.description) ?? null
        })
      }
    });
    return toCategoryPayload(row);
  },

  async createItem(input: unknown, actor?: AuthUser | null): Promise<StockItem> {
    assertNoDirectOnHandMutation(input);
    const data = stockItemCreateInputSchema.parse(input);
    const sku = normaliseOptionalText(data.sku);
    const categoryId = normaliseOptionalText(data.categoryId);
    await assertCategoryExists(categoryId);

    if (sku) {
      const existing = await prisma.stockItem.findUnique({ where: { sku } });
      if (existing) throw new HttpError(409, 'An item with that SKU already exists');
    }

    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.stockItem.create({
        data: {
          sku: sku ?? null,
          name: data.name.trim(),
          categoryId: categoryId ?? null,
          unit: data.unit.trim(),
          parLevel: data.parLevel,
          reorderPoint: normaliseOptionalNumber(data.reorderPoint) ?? null,
          avgCostCents: normaliseOptionalNumber(data.avgCostCents) ?? null,
          status: data.status,
          notes: normaliseOptionalText(data.notes) ?? null
        },
        include: { category: { select: { id: true, name: true } } }
      });

      if (actor && !isAdminActor(actor) && actor.venue) {
        await tx.venueStockItem.create({
          data: {
            venue: actor.venue,
            stockItemId: created.id,
            parLevel: data.parLevel,
            reorderPoint: normaliseOptionalNumber(data.reorderPoint) ?? null,
            active: data.status === 'ACTIVE'
          }
        });
      }

      return created;
    });

    return toItemPayload(row);
  },

  async updateItem(id: string, input: unknown): Promise<StockItem> {
    assertNoDirectOnHandMutation(input);
    const data = stockItemUpdateInputSchema.parse(input);
    const existing = await prisma.stockItem.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Item not found');

    const sku = data.sku !== undefined ? normaliseOptionalText(data.sku) : undefined;
    const categoryId =
      data.categoryId !== undefined ? normaliseOptionalText(data.categoryId) : undefined;
    await assertCategoryExists(categoryId);

    if (sku && sku !== existing.sku) {
      const conflict = await prisma.stockItem.findUnique({ where: { sku } });
      if (conflict) throw new HttpError(409, 'An item with that SKU already exists');
    }

    const row = await prisma.stockItem.update({
      where: { id },
      data: {
        ...(data.sku !== undefined && { sku: sku ?? null }),
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.categoryId !== undefined && { categoryId: categoryId ?? null }),
        ...(data.unit !== undefined && { unit: data.unit.trim() }),
        ...(data.parLevel !== undefined && { parLevel: data.parLevel }),
        ...(data.reorderPoint !== undefined && {
          reorderPoint: normaliseOptionalNumber(data.reorderPoint) ?? null
        }),
        ...(data.avgCostCents !== undefined && {
          avgCostCents: normaliseOptionalNumber(data.avgCostCents) ?? null
        }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.notes !== undefined && { notes: normaliseOptionalText(data.notes) })
      },
      include: { category: { select: { id: true, name: true } } }
    });

    return toItemPayload(row);
  },

  async upsertVenueStock(itemId: string, input: unknown, actor?: AuthUser | null): Promise<VenueStockItem> {
    const data = venueStockItemUpdateInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue);
    if (!venue) throw new HttpError(400, 'Venue is required for stock settings');
    await assertKnownVenue(venue, actor);

    const item = await prisma.stockItem.findUnique({ where: { id: itemId } });
    if (!item) throw new HttpError(404, 'Item not found');

    const row = await prisma.venueStockItem.upsert({
      where: { venue_stockItemId: { venue, stockItemId: itemId } },
      create: {
        venue,
        stockItemId: itemId,
        parLevel: data.parLevel ?? null,
        reorderPoint: data.reorderPoint ?? null,
        unitOverride: normaliseOptionalText(data.unitOverride) ?? null,
        active: data.active ?? (item.status === 'ACTIVE')
      },
      update: {
        parLevel: data.parLevel ?? null,
        reorderPoint: data.reorderPoint ?? null,
        unitOverride: normaliseOptionalText(data.unitOverride) ?? null,
        ...(data.active !== undefined && { active: data.active })
      },
      include: { stockItem: { include: { category: { select: { id: true, name: true } } } } }
    });

    return toVenueStockPayload(row);
  },

  async deleteItems(input: unknown): Promise<{ deleted: number }> {
    const { ids } = stockItemBulkDeleteInputSchema.parse(input);
    const uniqueIds = Array.from(new Set(ids));

    const [recipeLines, stocktakeLines, movements, invoiceLines] = await Promise.all([
      prisma.recipeLine.findMany({
        where: { itemId: { in: uniqueIds } },
        select: { itemId: true },
        distinct: ['itemId']
      }),
      prisma.stocktakeLine.findMany({
        where: { itemId: { in: uniqueIds } },
        select: { itemId: true },
        distinct: ['itemId']
      }),
      prisma.inventoryMovement.findMany({
        where: { itemId: { in: uniqueIds } },
        select: { itemId: true },
        distinct: ['itemId']
      }),
      prisma.supplierInvoiceLine.findMany({
        where: { itemId: { in: uniqueIds } },
        select: { itemId: true },
        distinct: ['itemId']
      })
    ]);

    const referencedIds = new Set<string>();
    for (const row of [...recipeLines, ...stocktakeLines, ...movements, ...invoiceLines]) {
      if (row.itemId) referencedIds.add(row.itemId);
    }
    if (referencedIds.size > 0) {
      const referencedItems = await prisma.stockItem.findMany({
        where: { id: { in: Array.from(referencedIds) } },
        select: { name: true },
        orderBy: { name: 'asc' },
        take: 3
      });
      const sample = referencedItems.map((item) => item.name).join(', ');
      throw new HttpError(
        409,
        `Cannot delete ${referencedIds.size} item${referencedIds.size === 1 ? '' : 's'} because ${referencedIds.size === 1 ? 'it is' : 'they are'} used by recipes, stocktakes, inventory movements, or invoices. Archive items instead.${sample ? ` Affected: ${sample}${referencedIds.size > 3 ? ', ...' : ''}` : ''}`
      );
    }

    const result = await prisma.stockItem.deleteMany({
      where: { id: { in: uniqueIds } }
    });

    return { deleted: result.count };
  }
};
