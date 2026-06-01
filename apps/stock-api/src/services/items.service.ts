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

function normaliseConversionFactor(value: number | undefined, fallback = 1) {
  if (value === undefined || Number.isNaN(value) || value <= 0) return fallback;
  return value;
}

function unitCostFromPurchaseCost(latestCostCents: number | null | undefined, conversionFactor: number) {
  if (latestCostCents === null || latestCostCents === undefined) return undefined;
  return Math.round(latestCostCents / Math.max(conversionFactor, 1));
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
    countUnit: row.countUnit,
    conversionFactor: row.conversionFactor,
    countArea: row.countArea,
    latestCostCents: row.latestCostCents,
    latestCostAt: row.latestCostAt?.toISOString() ?? null,
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
      countUnit: row.stockItem.countUnit,
      conversionFactor: row.stockItem.conversionFactor,
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
      where: { accountType: 'HUMAN', venue: { not: null }, employmentStatus: { not: 'ARCHIVED' } },
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

  // Per-item usage history over the last N weeks. Used to compute a
  // suggested par level. Stocktake-line diffs are the proxy for usage:
  // a negative variance between consecutive stocktakes = stock consumed.
  async usageHistory(itemId: string, opts: { venue?: string; weeks?: number } = {}) {
    const weeks = Math.min(Math.max(opts.weeks ?? 12, 1), 52);
    const earliest = new Date();
    earliest.setDate(earliest.getDate() - weeks * 7);

    const item = await prisma.stockItem.findUnique({
      where: { id: itemId },
      include: { venueStock: opts.venue ? { where: { venue: opts.venue } } : false }
    });
    if (!item) throw new Error('Stock item not found');

    const lines = await prisma.stocktakeLine.findMany({
      where: {
        itemId,
        stocktake: {
          countedAt: { gte: earliest },
          ...(opts.venue ? { venue: opts.venue } : {})
        }
      },
      include: { stocktake: { select: { countedAt: true, venue: true } } },
      orderBy: { stocktake: { countedAt: 'asc' } }
    });

    // Group lines by ISO week-start (Monday)
    const weekBuckets = new Map<string, { weekStart: string; counted: number | null; count: number }>();
    for (let i = 0; i <= weeks; i += 1) {
      const start = new Date();
      start.setDate(start.getDate() - i * 7);
      start.setHours(0, 0, 0, 0);
      const day = start.getDay();
      start.setDate(start.getDate() - day + (day === 0 ? -6 : 1));
      const key = start.toISOString().slice(0, 10);
      weekBuckets.set(key, { weekStart: key, counted: null, count: 0 });
    }
    for (const line of lines) {
      if (line.countedQty == null || !line.stocktake) continue;
      const ws = new Date(line.stocktake.countedAt);
      ws.setHours(0, 0, 0, 0);
      const day = ws.getDay();
      ws.setDate(ws.getDate() - day + (day === 0 ? -6 : 1));
      const key = ws.toISOString().slice(0, 10);
      const bucket = weekBuckets.get(key);
      if (!bucket) continue;
      // Average the counted quantity across multiple stocktakes in the same week
      bucket.counted = bucket.counted == null
        ? Number(line.countedQty)
        : (bucket.counted * bucket.count + Number(line.countedQty)) / (bucket.count + 1);
      bucket.count += 1;
    }

    const sortedWeeks = Array.from(weekBuckets.values()).sort((a, b) => a.weekStart.localeCompare(b.weekStart));

    // Calculate weekly usage as the absolute drop between consecutive counts
    const usage: Array<{ weekStart: string; usage: number | null }> = [];
    for (let i = 1; i < sortedWeeks.length; i += 1) {
      const prev = sortedWeeks[i - 1]!;
      const curr = sortedWeeks[i]!;
      if (prev.counted == null || curr.counted == null) {
        usage.push({ weekStart: curr.weekStart, usage: null });
      } else {
        const diff = prev.counted - curr.counted;
        // Only count positive drops (negative would mean stock was added —
        // probably an invoice/restock, not relevant for par usage)
        usage.push({ weekStart: curr.weekStart, usage: Math.max(0, diff) });
      }
    }

    const validUsages = usage.map((u) => u.usage).filter((u): u is number => u != null && u > 0);
    const avgWeeklyUsage = validUsages.length
      ? validUsages.reduce((sum, u) => sum + u, 0) / validUsages.length
      : null;
    // Suggested par = avg weekly usage × 1.4 buffer, rounded up
    const suggestedPar = avgWeeklyUsage != null ? Math.ceil(avgWeeklyUsage * 1.4) : null;
    const currentPar = item.venueStock?.[0]?.parLevel ?? item.parLevel ?? null;

    return {
      itemId,
      itemName: item.name,
      unit: item.unit,
      venue: opts.venue ?? null,
      weeks: sortedWeeks,
      weeklyUsage: usage,
      avgWeeklyUsage,
      currentPar,
      suggestedPar,
      sampleSize: validUsages.length
    };
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
    const countUnit = normaliseOptionalText(data.countUnit);
    const countArea = normaliseOptionalText(data.countArea);
    const conversionFactor = normaliseConversionFactor(data.conversionFactor);
    const latestCostCents = normaliseOptionalNumber(data.latestCostCents);
    const avgCostCents =
      data.avgCostCents !== undefined
        ? normaliseOptionalNumber(data.avgCostCents) ?? null
        : unitCostFromPurchaseCost(latestCostCents, conversionFactor) ?? null;
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
          countUnit: countUnit ?? null,
          conversionFactor,
          countArea: countArea ?? null,
          latestCostCents: latestCostCents ?? null,
          latestCostAt: latestCostCents !== undefined ? new Date() : null,
          parLevel: data.parLevel,
          reorderPoint: normaliseOptionalNumber(data.reorderPoint) ?? null,
          avgCostCents,
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
    const countUnit = data.countUnit !== undefined ? normaliseOptionalText(data.countUnit) : undefined;
    const countArea = data.countArea !== undefined ? normaliseOptionalText(data.countArea) : undefined;
    const nextConversionFactor =
      data.conversionFactor !== undefined
        ? normaliseConversionFactor(data.conversionFactor)
        : existing.conversionFactor;
    const nextLatestCostCents =
      data.latestCostCents !== undefined
        ? normaliseOptionalNumber(data.latestCostCents) ?? null
        : existing.latestCostCents;
    const avgCostCents =
      data.avgCostCents !== undefined
        ? normaliseOptionalNumber(data.avgCostCents) ?? null
        : data.latestCostCents !== undefined || data.conversionFactor !== undefined
          ? unitCostFromPurchaseCost(nextLatestCostCents, nextConversionFactor) ?? null
          : undefined;
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
        ...(data.countUnit !== undefined && { countUnit: countUnit ?? null }),
        ...(data.conversionFactor !== undefined && { conversionFactor: nextConversionFactor }),
        ...(data.countArea !== undefined && { countArea: countArea ?? null }),
        ...(data.latestCostCents !== undefined && {
          latestCostCents: nextLatestCostCents,
          latestCostAt: nextLatestCostCents !== null ? new Date() : null
        }),
        ...(data.parLevel !== undefined && { parLevel: data.parLevel }),
        ...(data.reorderPoint !== undefined && {
          reorderPoint: normaliseOptionalNumber(data.reorderPoint) ?? null
        }),
        ...(avgCostCents !== undefined && { avgCostCents }),
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
  },

  // Data quality report for the Loaded replacement catalogue check
  // (Sprint 1 #5). Returns counts per warning type plus an actionable
  // list of problem items so the admin can fix them in bulk.
  //
  // Warnings:
  //   missing_unit              - unit (purchase unit) is null/empty
  //   missing_count_unit        - countUnit is null AND unit != generic
  //   missing_conversion        - conversionFactor is 1 but countUnit
  //                               differs from unit (likely unconfigured)
  //   missing_category          - categoryId is null
  //   missing_count_area        - countArea is null (item has no walking
  //                               group, so stocktake can't be ordered)
  //   missing_latest_cost       - latestCostCents is null
  //   stale_latest_cost         - latestCostAt older than 90 days
  async dataQualityReport(actor?: AuthUser | null, options: { staleDays?: number } = {}) {
    const items = await prisma.stockItem.findMany({
      where: { status: 'ACTIVE' },
      include: { category: { select: { id: true, name: true } } }
    });
    const staleDays = options.staleDays ?? 90;
    const staleCutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);

    const warningsByItem = items.map((item) => {
      const warnings: string[] = [];
      if (!item.unit || !item.unit.trim()) warnings.push('missing_unit');
      if (!item.countUnit) warnings.push('missing_count_unit');
      if (item.conversionFactor === 1 && item.countUnit && item.countUnit !== item.unit) {
        warnings.push('missing_conversion');
      }
      if (!item.categoryId) warnings.push('missing_category');
      if (!item.countArea) warnings.push('missing_count_area');
      if (item.latestCostCents === null && item.avgCostCents === null) warnings.push('missing_latest_cost');
      if (item.latestCostAt && item.latestCostAt < staleCutoff) warnings.push('stale_latest_cost');
      return { item, warnings };
    });

    const counts: Record<string, number> = {
      missing_unit: 0,
      missing_count_unit: 0,
      missing_conversion: 0,
      missing_category: 0,
      missing_count_area: 0,
      missing_latest_cost: 0,
      stale_latest_cost: 0
    };
    for (const entry of warningsByItem) {
      for (const w of entry.warnings) counts[w] = (counts[w] ?? 0) + 1;
    }

    // Items with warnings, sorted by warning count (worst first) so the
    // admin can fix the biggest ones in one pass.
    const problemItems = warningsByItem
      .filter((entry) => entry.warnings.length > 0)
      .sort((a, b) => b.warnings.length - a.warnings.length)
      .slice(0, 200)
      .map((entry) => ({
        id: entry.item.id,
        name: entry.item.name,
        category: entry.item.category?.name ?? null,
        unit: entry.item.unit,
        countUnit: entry.item.countUnit,
        countArea: entry.item.countArea,
        conversionFactor: entry.item.conversionFactor,
        latestCostCents: entry.item.latestCostCents ?? entry.item.avgCostCents,
        latestCostAt: entry.item.latestCostAt?.toISOString() ?? null,
        warnings: entry.warnings
      }));

    // Distinct count areas in current use — useful for the admin to see
    // their walking-order configuration without a separate settings UI.
    const areas = Array.from(new Set(items.map((item) => item.countArea).filter((area): area is string => Boolean(area)))).sort();

    // Overall data quality grade — drives the Reports + Loaded replacement
    // "Good / Partial / Poor" indicator the spec calls for.
    const totalActive = items.length;
    const itemsWithAnyWarning = warningsByItem.filter((entry) => entry.warnings.length > 0).length;
    const ratio = totalActive === 0 ? 1 : 1 - itemsWithAnyWarning / totalActive;
    const quality: 'good' | 'partial' | 'poor' = ratio >= 0.9 ? 'good' : ratio >= 0.6 ? 'partial' : 'poor';

    return {
      generatedAt: new Date().toISOString(),
      totalActiveItems: totalActive,
      itemsWithWarning: itemsWithAnyWarning,
      quality,
      counts,
      countAreas: areas,
      problemItems,
      _scope: { venue: actorVenueScope(actor) }
    };
  }
};
