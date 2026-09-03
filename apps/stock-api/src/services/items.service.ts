import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import {
  implausibleCountLines,
  summarisePurchases,
  type PurchaseFacts,
  type PurchaseLine,
  stockCategoryCreateInputSchema,
  stockCategoryUpdateInputSchema,
  stockItemBulkDeleteInputSchema,
  stockItemMergeInputSchema,
  type StockItemMergeResult,
  findDuplicateGroups,
  type StockItemDuplicateGroup,
  type StockItemDuplicatesPayload,
  stockItemBulkUpdateInputSchema,
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
  type StockConfigHealthIssue,
  type StockConfigHealthItem,
  type StockConfigHealthPayload,
  type AuthUser
} from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { actorPinnedVenue, isVenueUnscopedActor } from '../lib/venue-scope.js';
import { convertQuantityToCostUnit } from './units.js';

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

// Every relation that references a StockItem. Used by delete (refuse when
// anything hangs off the item) and by the duplicate report (the item with the
// most history is the one to keep). Add a relation here when the schema gains
// one; the merge below must repoint it too.
const ITEM_REFERENCE_COUNTS = {
  recipeLines: true,
  stocktakeLines: true,
  invoiceLines: true,
  movements: true,
  transfers: true,
  wastageRecords: true,
  deliveryCheckItems: true,
  reorderNotices: true,
  squareMenuMappings: true,
  purchaseOrderLines: true,
  priceListItems: true,
  aliases: true,
  venueStock: true
} as const satisfies Prisma.StockItemCountOutputTypeSelect;

function referenceCountOf(count: Record<keyof typeof ITEM_REFERENCE_COUNTS, number>) {
  return Object.values(count).reduce((sum, value) => sum + value, 0);
}

// The item to keep when merging a duplicate group: most history, then the
// one with a sku, then the one with a cost, then the more descriptive name.
function suggestMergeParent(
  items: Array<{ id: string; name: string; sku: string | null; latestCostCents: number | null; referenceCount: number }>
) {
  const sorted = [...items].sort(
    (a, b) =>
      b.referenceCount - a.referenceCount ||
      Number(Boolean(b.sku)) - Number(Boolean(a.sku)) ||
      Number((b.latestCostCents ?? 0) > 0) - Number((a.latestCostCents ?? 0) > 0) ||
      b.name.length - a.name.length
  );
  return sorted[0]!.id;
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
    measurePerCountUnit: row.measurePerCountUnit ?? null,
    measureUnit: row.measureUnit ?? null,
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
  if (!actor || isVenueUnscopedActor(actor)) return venue;
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
      if (onHand === null || line.countedQty == null) return summary;
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
  if (actor && !isVenueUnscopedActor(actor)) {
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

    // Combined on-hand across EVERY venue (unscoped), so the items list can show
    // a single total instead of just the selected venue's holding.
    const totalsRaw = await prisma.venueStockItem.groupBy({
      by: ['stockItemId'],
      _sum: { onHand: true }
    });
    const totalOnHandByItem = new Map(totalsRaw.map((row) => [row.stockItemId, row._sum.onHand ?? 0]));

    return {
      items: items.map((item) => {
        const payload = toItemPayload(item);
        const totalOnHand = totalOnHandByItem.get(item.id) ?? item.onHand;
        const venueStock = scopedVenueStockByItemId.get(item.id);
        return venueStock
          ? { ...payload, totalOnHand, venueStock: toVenueStockPayload(venueStock) }
          : { ...payload, totalOnHand };
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

  /**
   * The catalogue as a picker sees it.
   *
   * Seven screens — stocktake, recipes, invoices, purchase orders, transfers,
   * templates and settings — loaded the full list() payload purely to fill an
   * item dropdown. That is 437 KB for 716 items here, and more in production
   * where list() also returns every VenueStockItem with a nested copy of its
   * item. None of those screens read createdAt, notes, par levels, reorder
   * points or the category object; they read a name, a unit, a conversion and
   * a cost.
   *
   * The Items page itself still uses list() — it genuinely edits every field.
   *
   * Venue scoping and the on-hand merge are identical to list(), so a picker
   * shows the same stock position the items page does. A leaner payload must
   * not mean a differently-scoped one.
   */
  async picker(actor?: AuthUser | null, requestedVenue?: string | null) {
    const venue = actorVenueScope(actor, requestedVenue);
    const [items, categories, venueStockItems, totalsRaw] = await Promise.all([
      prisma.stockItem.findMany({
        select: {
          id: true,
          name: true,
          sku: true,
          unit: true,
          countUnit: true,
          conversionFactor: true,
          measurePerCountUnit: true,
          measureUnit: true,
          avgCostCents: true,
          latestCostCents: true,
          onHand: true,
          status: true,
          categoryId: true,
          category: { select: { id: true, name: true } }
        },
        orderBy: [{ status: 'asc' }, { name: 'asc' }]
      }),
      prisma.stockCategory.findMany({ orderBy: { name: 'asc' } }),
      prisma.venueStockItem.findMany({
        where: scopedVenueStockWhere(actor, requestedVenue),
        orderBy: [{ venue: 'asc' }, { updatedAt: 'desc' }]
      }),
      prisma.venueStockItem.groupBy({ by: ['stockItemId'], _sum: { onHand: true } })
    ]);

    const scopedByItemId = venue
      ? new Map(venueStockItems.filter((row) => row.venue === venue).map((row) => [row.stockItemId, row]))
      : new Map<string, (typeof venueStockItems)[number]>();
    const totalOnHandByItem = new Map(totalsRaw.map((row) => [row.stockItemId, row._sum.onHand ?? 0]));

    return {
      items: items.map((item) => {
        const scoped = scopedByItemId.get(item.id);
        return {
          ...item,
          categoryName: item.category?.name ?? null,
          category: undefined,
          totalOnHand: totalOnHandByItem.get(item.id) ?? item.onHand,
          venueStock: scoped ? { venue: scoped.venue, onHand: scoped.onHand } : undefined
        };
      }),
      categories: categories.map(toCategoryPayload),
      venue,
      scope: { venue, admin: isAdminActor(actor), stockItemsVenueScoped: true }
    };
  },

  /**
   * Stock value and the per-category rollup, computed here.
   *
   * Reports downloaded the entire 402 KB catalogue to work these out in the
   * browser: a total of onHand x avgCost, and counts/value/low-stock grouped by
   * category. It is an aggregation, so it belongs on this side of the wire —
   * the answer is about a kilobyte.
   *
   * The venue-rows-vs-items fallback is reproduced exactly as Reports had it:
   * when active venue stock rows exist they are the source of truth (they hold
   * the real per-venue holding), and only when there are none does it fall back
   * to the item-level onHand. Changing that would change the stock value shown
   * on the dashboard, which is a different kind of change from making it fast.
   */
  async valueByCategory(actor?: AuthUser | null, requestedVenue?: string | null) {
    const venue = actorVenueScope(actor, requestedVenue);
    const venueRows = await prisma.venueStockItem.findMany({
      where: {
        ...(venue ? { venue } : {}),
        active: true,
        stockItem: { status: 'ACTIVE' }
      },
      select: {
        onHand: true,
        parLevel: true,
        reorderPoint: true,
        stockItem: {
          select: {
            avgCostCents: true,
            parLevel: true,
            reorderPoint: true,
            category: { select: { name: true } }
          }
        }
      }
    });

    type Row = { category: string; itemCount: number; valueCents: number; lowStock: number };
    const buckets = new Map<string, Row>();
    const bucket = (name: string) => {
      const existing = buckets.get(name);
      if (existing) return existing;
      const created: Row = { category: name, itemCount: 0, valueCents: 0, lowStock: 0 };
      buckets.set(name, created);
      return created;
    };

    let totalValueCents = 0;
    const usesVenueRows = venueRows.length > 0;

    if (usesVenueRows) {
      for (const row of venueRows) {
        const value = Math.round((row.onHand ?? 0) * (row.stockItem.avgCostCents ?? 0));
        totalValueCents += value;
        const entry = bucket(row.stockItem.category?.name ?? 'Uncategorised');
        entry.itemCount += 1;
        entry.valueCents += value;
        const threshold = row.reorderPoint ?? row.parLevel ?? row.stockItem.reorderPoint ?? row.stockItem.parLevel ?? 0;
        if (row.onHand !== null && threshold > 0 && row.onHand <= threshold) entry.lowStock += 1;
      }
    } else {
      const items = await prisma.stockItem.findMany({
        select: { onHand: true, avgCostCents: true, category: { select: { name: true } } }
      });
      for (const item of items) {
        const value = Math.round(item.onHand * (item.avgCostCents ?? 0));
        totalValueCents += value;
        const entry = bucket(item.category?.name ?? 'Uncategorised');
        entry.itemCount += 1;
        entry.valueCents += value;
      }
    }

    return {
      totalValueCents,
      // Tells Reports which basis produced these numbers, so the label it shows
      // ("Venue rows" vs "Items") stays truthful.
      basis: usesVenueRows ? ('VENUE_ROWS' as const) : ('ITEMS' as const),
      categories: [...buckets.values()].sort((a, b) => b.valueCents - a.valueCents),
      venue
    };
  },

  // Full-catalogue CSV export — every item with its current category, count
  // area, unit, status and latest cost. Column names line up with the
  // categorize-items helper (item / sku / category) so it round-trips.
  async exportCsv(): Promise<{ filename: string; csv: string }> {
    const items = await prisma.stockItem.findMany({
      include: { category: { select: { name: true } } },
      orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }]
    });

    const csvCell = (value: unknown): string => {
      const text = value == null ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const headers = ['item', 'sku', 'category', 'count_area', 'unit', 'count_unit', 'status', 'latest_cost_cents'];
    const rows = items.map((item) => [
      item.name,
      item.sku ?? '',
      item.category?.name ?? '',
      item.countArea ?? '',
      item.unit ?? '',
      item.countUnit ?? '',
      item.status,
      item.latestCostCents ?? item.avgCostCents ?? ''
    ]);

    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
    return { filename: 'alma-stock-items.csv', csv };
  },

  /**
   * Where each item is bought from and what it costs, derived from the
   * invoices already entered.
   *
   * The supplier price list is where this "should" live and it holds 0 rows in
   * production, because it is a second catalogue somebody would have to keep
   * up by hand next to the invoices they already process. Reading the invoices
   * asks for the data once.
   *
   * Only covers items whose invoice lines have been matched — 123 of 716
   * today, growing as the review queue is cleared. An item with no history
   * reports nothing rather than a guess.
   */
  async purchaseFacts(itemIds?: string[]): Promise<Map<string, PurchaseFacts>> {
    const lines = await prisma.supplierInvoiceLine.findMany({
      where: {
        itemId: itemIds?.length ? { in: itemIds } : { not: null },
        unitAmountCents: { gt: 0 },
        // A line somebody actively set aside as a charge is not a purchase of
        // this item, even if it somehow carries an itemId.
        matchingStatus: { not: 'NON_STOCK' }
      },
      select: {
        itemId: true,
        unitAmountCents: true,
        lineAmountCents: true,
        quantity: true,
        // Needed because the importer frequently records quantity as 1 and
        // leaves the real figure only in the supplier's own wording.
        description: true,
        invoice: { select: { supplierId: true, supplierName: true, invoiceDate: true, createdAt: true } }
      }
    });

    const grouped = new Map<string, PurchaseLine[]>();
    for (const line of lines) {
      if (!line.itemId) continue;
      const list = grouped.get(line.itemId) ?? [];
      list.push({
        supplierId: line.invoice?.supplierId ?? null,
        supplierName: line.invoice?.supplierName ?? null,
        unitAmountCents: line.unitAmountCents,
        lineAmountCents: line.lineAmountCents,
        quantity: line.quantity,
        description: line.description,
        // The invoice date is when the price was actually paid. Falling back to
        // createdAt would order purchases by when somebody got round to
        // importing them, which is not the same thing.
        purchasedAt: line.invoice?.invoiceDate ?? line.invoice?.createdAt ?? new Date(0)
      });
      grouped.set(line.itemId, list);
    }

    const out = new Map<string, PurchaseFacts>();
    for (const [itemId, itemLines] of grouped) {
      out.set(itemId, summarisePurchases(itemLines));
    }
    return out;
  },

  /**
   * The catalogue seen the way a buyer sees it: grouped by who supplies each
   * item, with what was last paid.
   *
   * Items nothing has ever been bought for are grouped separately rather than
   * hidden — "we have no idea where this comes from" is a real answer a buyer
   * needs, and today it is most of the catalogue.
   */
  async bySupplier(actor?: AuthUser | null, requestedVenue?: string | null) {
    const venue = actorVenueScope(actor, requestedVenue);
    const [items, facts] = await Promise.all([
      prisma.stockItem.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true, name: true, unit: true, countUnit: true, conversionFactor: true,
          parLevel: true, reorderPoint: true, onHand: true,
          latestCostCents: true, latestCostAt: true,
          category: { select: { id: true, name: true } },
          venueStock: venue
            ? { where: { venue }, select: { onHand: true, parLevel: true, reorderPoint: true } }
            : false
        },
        orderBy: [{ name: 'asc' }]
      }),
      this.purchaseFacts()
    ]);

    const groups = new Map<string, {
      supplierId: string | null;
      supplierName: string;
      items: Array<Record<string, unknown>>;
    }>();

    for (const item of items) {
      const fact = facts.get(item.id) ?? null;
      const key = fact?.supplierId ?? '__none__';
      if (!groups.has(key)) {
        groups.set(key, {
          supplierId: fact?.supplierId ?? null,
          supplierName: fact?.supplierName ?? 'No purchase history',
          items: []
        });
      }
      const venueRow = Array.isArray(item.venueStock) ? item.venueStock[0] : null;
      groups.get(key)!.items.push({
        id: item.id,
        name: item.name,
        unit: item.unit,
        countUnit: item.countUnit,
        conversionFactor: item.conversionFactor,
        category: item.category,
        // Venue figures win when a venue is in scope; the item-level numbers
        // are the group-wide fallback.
        onHand: venueRow?.onHand ?? item.onHand,
        parLevel: venueRow?.parLevel ?? item.parLevel,
        reorderPoint: venueRow?.reorderPoint ?? item.reorderPoint,
        latestCostCents: item.latestCostCents,
        latestCostAt: item.latestCostAt ? item.latestCostAt.toISOString() : null,
        purchase: fact
      });
    }

    const ordered = [...groups.values()].sort((a, b) => {
      // Items nobody knows the source of sort last: they are a data gap to
      // work through, not a supplier to order from.
      if (a.supplierId === null) return 1;
      if (b.supplierId === null) return -1;
      return a.supplierName.localeCompare(b.supplierName);
    });

    return {
      venue,
      suppliers: ordered,
      itemsWithHistory: facts.size,
      itemsTotal: items.length,
      generatedAt: new Date().toISOString()
    };
  },

  /** One item's purchase history, for the item detail view. */
  async purchaseFactsForItem(itemId: string): Promise<PurchaseFacts | null> {
    const facts = await this.purchaseFacts([itemId]);
    return facts.get(itemId) ?? null;
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
    const measurePerCountUnit = normaliseOptionalNumber(data.measurePerCountUnit) ?? null;
    const measureUnit =
      (normaliseOptionalText(data.measureUnit) as 'g' | 'ml' | null) ??
      (measurePerCountUnit !== null ? 'g' : null);
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
          measurePerCountUnit,
          measureUnit,
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

      const pinnedVenue = actorPinnedVenue(actor);
      if (pinnedVenue) {
        await tx.venueStockItem.create({
          data: {
            venue: pinnedVenue,
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
        ...(data.measurePerCountUnit !== undefined && {
          measurePerCountUnit: normaliseOptionalNumber(data.measurePerCountUnit) ?? null,
          // default the measure unit to grams if a value is set without one
          ...(data.measureUnit === undefined &&
            normaliseOptionalNumber(data.measurePerCountUnit) != null &&
            !existing.measureUnit && { measureUnit: 'g' })
        }),
        ...(data.measureUnit !== undefined && {
          measureUnit: (normaliseOptionalText(data.measureUnit) as 'g' | 'ml' | null) ?? null
        }),
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

  async bulkUpdate(input: unknown): Promise<{ updated: number; venueUpdated: number }> {
    const data = stockItemBulkUpdateInputSchema.parse(input);
    const ids = Array.from(new Set(data.ids));

    // Validate a non-null category exists so a bad id can't FK-error the batch.
    if (data.categoryId) {
      const category = await prisma.stockCategory.findUnique({ where: { id: data.categoryId }, select: { id: true } });
      if (!category) throw new HttpError(400, 'Category not found.');
    }

    const patch: Prisma.StockItemUncheckedUpdateManyInput = {};
    if (data.categoryId !== undefined) patch.categoryId = data.categoryId;
    if (data.status !== undefined) patch.status = data.status;
    if (data.countArea !== undefined) patch.countArea = data.countArea?.trim() || null;

    let updated = 0;
    if (Object.keys(patch).length > 0) {
      const result = await prisma.stockItem.updateMany({ where: { id: { in: ids } }, data: patch });
      updated = result.count;
    }

    let venueUpdated = 0;
    const venue = data.venue?.trim();
    if (venue && data.venueActive !== undefined) {
      for (const stockItemId of ids) {
        await prisma.venueStockItem.upsert({
          where: { venue_stockItemId: { venue, stockItemId } },
          create: { venue, stockItemId, active: data.venueActive },
          update: { active: data.venueActive }
        });
        venueUpdated += 1;
      }
    }

    return { updated, venueUpdated };
  },

  async deleteItems(input: unknown): Promise<{ deleted: number }> {
    const { ids } = stockItemBulkDeleteInputSchema.parse(input);
    const uniqueIds = Array.from(new Set(ids));

    // Every relation that hangs off an item, not just the four that used to
    // be checked. Transfers, wastage, reorder notices and supplier aliases are
    // ON DELETE CASCADE, so an item that passed the old check took its
    // wastage records and inter-venue transfers with it when it went.
    const items = await prisma.stockItem.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, name: true, _count: { select: ITEM_REFERENCE_COUNTS } },
      orderBy: { name: 'asc' }
    });
    const referenced = items.filter((item) => referenceCountOf(item._count) > 0);
    if (referenced.length > 0) {
      const sample = referenced.slice(0, 3).map((item) => item.name).join(', ');
      throw new HttpError(
        409,
        `Cannot delete ${referenced.length} item${referenced.length === 1 ? '' : 's'} because ${referenced.length === 1 ? 'it is' : 'they are'} used by recipes, stocktakes, invoices, inventory movements, transfers, wastage, deliveries, orders or supplier aliases. Archive items instead, or merge them into the item you keep.${sample ? ` Affected: ${sample}${referenced.length > 3 ? ', ...' : ''}` : ''}`
      );
    }

    const result = await prisma.stockItem.deleteMany({
      where: { id: { in: uniqueIds } }
    });

    return { deleted: result.count };
  },

  // Server-side duplicate report. The grouping rule lives in @alma/shared
  // (stock-duplicates.ts) so it is one rule, tested once, rather than the
  // exact-tuple match the Items page used to do in the browser — which could
  // not see that "Limes" and "Lime" were the same shelf.
  async duplicates(): Promise<StockItemDuplicatesPayload> {
    const rows = await prisma.stockItem.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        sku: true,
        unit: true,
        countUnit: true,
        countArea: true,
        latestCostCents: true,
        onHand: true,
        createdAt: true,
        category: { select: { name: true } },
        venueStock: { select: { venue: true } },
        _count: { select: ITEM_REFERENCE_COUNTS }
      }
    });
    const groups = findDuplicateGroups(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        sku: row.sku,
        unit: row.unit,
        countUnit: row.countUnit,
        categoryName: row.category?.name ?? null,
        status: 'ACTIVE' as const,
        row
      }))
    );
    const payloadGroups: StockItemDuplicateGroup[] = groups.map((group) => {
      const items = group.items.map(({ row }) => ({
        id: row.id,
        name: row.name,
        sku: row.sku,
        unit: row.unit,
        countUnit: row.countUnit,
        categoryName: row.category?.name ?? null,
        countArea: row.countArea,
        latestCostCents: row.latestCostCents,
        onHand: row.onHand,
        venues: Array.from(new Set(row.venueStock.map((venue) => venue.venue))).sort(),
        referenceCount: referenceCountOf(row._count),
        createdAt: row.createdAt.toISOString()
      }));
      return {
        key: group.key,
        basis: group.basis,
        sizeConflict: group.sizeConflict,
        unitConflict: group.unitConflict,
        suggestedParentId: suggestMergeParent(items),
        items
      };
    });
    return { generatedAt: new Date().toISOString(), activeItems: rows.length, groups: payloadGroups };
  },

  // Merge duplicate items into a chosen parent. Every reference (recipes,
  // invoices, stocktakes, movements, deliveries, wastage, transfers, POs, Square
  // mappings, reorder notices, supplier aliases, price lists) is repointed onto
  // the parent inside one transaction. Per-venue stock is summed where the
  // parent already stocks that venue, otherwise moved onto the parent — so a
  // duplicate that only existed at St Alma makes the parent stocked at St Alma
  // too (one item, both venues). Blank fields on the parent are backfilled
  // from the duplicates so merging into the bare row loses no configuration.
  // Duplicates are archived with a note saying where their history went.
  //
  // Not undoable from the app: the archived row keeps its own name and sku,
  // but the moved history is not tagged. Treat it like the ledger it edits.
  async mergeItems(input: unknown, actor?: AuthUser | null): Promise<StockItemMergeResult> {
    const { parentId, duplicateIds } = stockItemMergeInputSchema.parse(input);
    // The catalogue is shared by every venue, and the merge unions venue
    // stock across all of them. A manager pinned to one venue would be
    // rewriting the other venue's history, so this is group-wide only.
    if (actor && !isVenueUnscopedActor(actor)) {
      throw new HttpError(403, 'Merging items changes the shared catalogue for every venue. Admin or group-wide manager access is required.');
    }
    const dupIds = Array.from(new Set(duplicateIds)).filter((id) => id !== parentId);
    if (dupIds.length === 0) throw new HttpError(400, 'Pick at least one different item to merge into the parent.');

    const itemInclude = { venueStock: true, aliases: true, priceListItems: true } as const;
    const parent = await prisma.stockItem.findUnique({ where: { id: parentId }, include: itemInclude });
    if (!parent) throw new HttpError(404, 'Parent item not found.');
    const dups = await prisma.stockItem.findMany({ where: { id: { in: dupIds } }, include: itemInclude });
    if (dups.length !== dupIds.length) throw new HttpError(404, 'One or more items to merge could not be found.');

    const venuesAdded = new Set<string>();
    const moved: StockItemMergeResult['moved'] = {
      recipeLines: 0,
      stocktakeLines: 0,
      invoiceLines: 0,
      movements: 0,
      aliases: 0,
      priceListItems: 0,
      purchaseOrderLines: 0
    };

    await prisma.$transaction(async (tx) => {
      // 1. Stocktake lines. Where a count already has a line for the parent
      //    AND one for a duplicate, fold them into the parent's line rather
      //    than leaving two lines for one item: apply and the variance report
      //    both keep "the last line for an item", so a second line would
      //    silently drop the first count. Units that disagree stay separate.
      const dupLines = await tx.stocktakeLine.findMany({
        where: { itemId: { in: dupIds } },
        select: { id: true, stocktakeId: true, countedQty: true, stockValueCents: true, notes: true, unit: true }
      });
      const stocktakeIds = Array.from(new Set(dupLines.map((line) => line.stocktakeId)));
      const parentLines = stocktakeIds.length
        ? await tx.stocktakeLine.findMany({
            where: { itemId: parentId, stocktakeId: { in: stocktakeIds } },
            select: { id: true, stocktakeId: true, countedQty: true, stockValueCents: true, notes: true, unit: true },
            orderBy: { position: 'asc' }
          })
        : [];
      const parentLineByStocktake = new Map<string, (typeof parentLines)[number]>();
      for (const line of parentLines) {
        if (!parentLineByStocktake.has(line.stocktakeId)) parentLineByStocktake.set(line.stocktakeId, line);
      }
      for (const line of dupLines) {
        const target = parentLineByStocktake.get(line.stocktakeId);
        const sameUnit =
          !target || !line.unit || !target.unit || line.unit.trim().toLowerCase() === target.unit.trim().toLowerCase();
        if (!target || !sameUnit) {
          await tx.stocktakeLine.update({ where: { id: line.id }, data: { itemId: parentId } });
          moved.stocktakeLines += 1;
          continue;
        }
        const countedQty =
          target.countedQty === null && line.countedQty === null
            ? null
            : (target.countedQty ?? 0) + (line.countedQty ?? 0);
        const stockValueCents =
          target.stockValueCents === null && line.stockValueCents === null
            ? null
            : (target.stockValueCents ?? 0) + (line.stockValueCents ?? 0);
        const notes = [target.notes, line.notes].filter((note) => note && note.trim()).join(' · ') || null;
        await tx.inventoryMovement.updateMany({
          where: { sourceStocktakeLineId: line.id },
          data: { sourceStocktakeLineId: target.id }
        });
        await tx.stocktakeLine.update({ where: { id: target.id }, data: { countedQty, stockValueCents, notes } });
        await tx.stocktakeLine.delete({ where: { id: line.id } });
        target.countedQty = countedQty;
        target.stockValueCents = stockValueCents;
        target.notes = notes;
        moved.stocktakeLines += 1;
      }

      // 2. Repoint every other history/reference relation onto the parent.
      moved.recipeLines = (await tx.recipeLine.updateMany({ where: { itemId: { in: dupIds } }, data: { itemId: parentId } })).count;
      moved.movements = (await tx.inventoryMovement.updateMany({ where: { itemId: { in: dupIds } }, data: { itemId: parentId } })).count;
      moved.invoiceLines = (await tx.supplierInvoiceLine.updateMany({ where: { itemId: { in: dupIds } }, data: { itemId: parentId } })).count;
      await tx.stockTransfer.updateMany({ where: { stockItemId: { in: dupIds } }, data: { stockItemId: parentId } });
      await tx.stockWastageRecord.updateMany({ where: { stockItemId: { in: dupIds } }, data: { stockItemId: parentId } });
      await tx.stockDeliveryCheckItem.updateMany({ where: { stockItemId: { in: dupIds } }, data: { stockItemId: parentId } });
      await tx.stockReorderNotice.updateMany({ where: { stockItemId: { in: dupIds } }, data: { stockItemId: parentId } });
      await tx.squareMenuRecipeMapping.updateMany({ where: { stockItemId: { in: dupIds } }, data: { stockItemId: parentId } });
      moved.purchaseOrderLines = (await tx.purchaseOrderLine.updateMany({ where: { stockItemId: { in: dupIds } }, data: { stockItemId: parentId } })).count;

      // 3. Supplier aliases — "this wording on an invoice means this item".
      //    Unique on (aliasKey, supplierId). Left pointing at the archived
      //    duplicate, every future invoice line would auto-match onto the
      //    archived row and quietly rebuild the duplicate's history.
      const parentAliasKeys = new Set(parent.aliases.map((alias) => `${alias.aliasKey}|${alias.supplierId ?? ''}`));
      for (const dup of dups) {
        for (const alias of dup.aliases) {
          const key = `${alias.aliasKey}|${alias.supplierId ?? ''}`;
          if (parentAliasKeys.has(key)) {
            await tx.stockItemAlias.delete({ where: { id: alias.id } });
          } else {
            await tx.stockItemAlias.update({ where: { id: alias.id }, data: { stockItemId: parentId } });
            parentAliasKeys.add(key);
          }
          moved.aliases += 1;
        }
      }

      // 4. Supplier price lists — unique on (supplierId, stockItemId). The
      //    parent keeps its own price for a supplier it already has; a
      //    supplier only the duplicate had moves across.
      const parentPriceSuppliers = new Set(parent.priceListItems.map((row) => row.supplierId));
      for (const dup of dups) {
        for (const row of dup.priceListItems) {
          if (parentPriceSuppliers.has(row.supplierId)) {
            await tx.supplierPriceListItem.delete({ where: { id: row.id } });
          } else {
            await tx.supplierPriceListItem.update({ where: { id: row.id }, data: { stockItemId: parentId } });
            parentPriceSuppliers.add(row.supplierId);
          }
          moved.priceListItems += 1;
        }
      }

      // 5. Venue stock — sum where the parent already has the venue, else move it
      //    onto the parent (unioning venue availability). A running map keeps
      //    multi-duplicate merges onto the same new venue from colliding.
      const parentVenues = new Map(parent.venueStock.map((row) => [row.venue, { id: row.id, onHand: row.onHand ?? 0, active: row.active }]));
      for (const dup of dups) {
        for (const vs of dup.venueStock) {
          const existing = parentVenues.get(vs.venue);
          if (existing) {
            existing.onHand += vs.onHand ?? 0;
            existing.active = existing.active || vs.active;
            await tx.venueStockItem.update({ where: { id: existing.id }, data: { onHand: existing.onHand, active: existing.active } });
            await tx.venueStockItem.delete({ where: { id: vs.id } });
          } else {
            await tx.venueStockItem.update({ where: { id: vs.id }, data: { stockItemId: parentId } });
            parentVenues.set(vs.venue, { id: vs.id, onHand: vs.onHand ?? 0, active: vs.active });
            venuesAdded.add(vs.venue);
          }
        }
      }

      // 6. Backfill what the parent is missing from the duplicates, first
      //    value wins. A fully configured duplicate merged into a bare parent
      //    used to lose its category, count unit and cost on the way.
      const backfill: Prisma.StockItemUpdateInput = {};
      const firstDupWith = <K extends keyof (typeof dups)[number]>(key: K) =>
        dups.find((dup) => dup[key] !== null && dup[key] !== undefined && dup[key] !== '');
      if (!parent.sku) {
        const source = firstDupWith('sku');
        if (source?.sku) {
          // sku is unique — free it on the duplicate before the parent takes it.
          await tx.stockItem.update({ where: { id: source.id }, data: { sku: null } });
          backfill.sku = source.sku;
        }
      }
      if (!parent.categoryId) {
        const source = firstDupWith('categoryId');
        if (source?.categoryId) backfill.category = { connect: { id: source.categoryId } };
      }
      if (!parent.countUnit) {
        const source = firstDupWith('countUnit');
        if (source?.countUnit) {
          backfill.countUnit = source.countUnit;
          // The factor only means anything with the count unit it was set for.
          if ((parent.conversionFactor ?? 1) === 1 && source.conversionFactor > 0) {
            backfill.conversionFactor = source.conversionFactor;
          }
        }
      }
      if (!parent.countArea) {
        const source = firstDupWith('countArea');
        if (source?.countArea) backfill.countArea = source.countArea;
      }
      if (parent.measurePerCountUnit === null) {
        const source = firstDupWith('measurePerCountUnit');
        if (source?.measurePerCountUnit) {
          backfill.measurePerCountUnit = source.measurePerCountUnit;
          backfill.measureUnit = source.measureUnit;
        }
      }
      if (parent.latestCostCents === null) {
        const source = firstDupWith('latestCostCents');
        if (source?.latestCostCents !== null && source?.latestCostCents !== undefined) {
          backfill.latestCostCents = source.latestCostCents;
          backfill.latestCostAt = source.latestCostAt;
        }
      }
      if (parent.avgCostCents === null) {
        const source = firstDupWith('avgCostCents');
        if (source?.avgCostCents !== null && source?.avgCostCents !== undefined) backfill.avgCostCents = source.avgCostCents;
      }
      if (parent.reorderPoint === null) {
        const source = firstDupWith('reorderPoint');
        if (source?.reorderPoint !== null && source?.reorderPoint !== undefined) backfill.reorderPoint = source.reorderPoint;
      }
      if (!parent.parLevel) {
        const source = dups.find((dup) => dup.parLevel > 0);
        if (source) backfill.parLevel = source.parLevel;
      }

      // 7. Recompute the parent's rolled-up on-hand from its venue rows.
      const rows = await tx.venueStockItem.findMany({ where: { stockItemId: parentId }, select: { onHand: true } });
      await tx.stockItem.update({
        where: { id: parentId },
        data: { ...backfill, onHand: rows.reduce((sum, row) => sum + (row.onHand ?? 0), 0) }
      });

      // 8. Archive the now-empty duplicates, keeping whatever note they had.
      const actorName = actor ? `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() || actor.email || actor.id : 'system';
      const stamp = new Date().toISOString().slice(0, 10);
      for (const dup of dups) {
        const mergeNote = `Merged into "${parent.name}" (${parentId}) on ${stamp} by ${actorName}.`;
        const notes = dup.notes?.trim() ? `${dup.notes.trim()}\n\n${mergeNote}` : mergeNote;
        await tx.stockItem.update({
          where: { id: dup.id },
          data: { status: 'ARCHIVED', onHand: 0, notes }
        });
      }
    }, { maxWait: 15_000, timeout: 60_000 });

    return { parentId, mergedCount: dups.length, venuesAdded: Array.from(venuesAdded), moved };
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
  },

  // Costing-trust health: which active items are silently mis-configured so they
  // cost $0 or wrong in recipes and stock value. Unlike the generic hygiene
  // report, this only flags issues that actually corrupt money, ranks them by
  // impact (recipes affected, then on-hand value), and names the recipes that
  // break — so the gap that quietly zeroed a figure becomes a fix-it worklist.
  async configHealth(options: { staleDays?: number } = {}): Promise<StockConfigHealthPayload> {
    const items = await prisma.stockItem.findMany({
      where: { status: 'ACTIVE' },
      include: {
        category: { select: { name: true } },
        recipeLines: {
          select: { quantity: true, unit: true, recipe: { select: { id: true, title: true } } }
        }
      }
    });

    // Counts made in the wrong unit. Every field on these lines is individually
    // valid — a number, a real cost, a real unit — so nothing else here can see
    // them; only the product is absurd. In production eight such lines carried
    // 76% of all counted stock value, and the par levels derived from them made
    // the reorder screen propose a $2.17M order.
    const countedLines = await prisma.stocktakeLine.findMany({
      where: { itemId: { not: null }, countedQty: { not: null } },
      select: {
        itemId: true,
        label: true,
        countedQty: true,
        stocktake: { select: { venue: true } },
        item: {
          select: {
            name: true,
            avgCostCents: true,
            countUnit: true,
            measurePerCountUnit: true,
            measureUnit: true
          }
        }
      }
    });
    const badCounts = implausibleCountLines(
      countedLines
        .filter((line) => line.item)
        .map((line) => ({
          itemId: line.itemId!,
          itemName: line.item!.name,
          venue: line.stocktake?.venue ?? null,
          countedQty: line.countedQty ?? 0,
          unitCostCents: line.item!.avgCostCents,
          countUnit: line.item!.countUnit,
          measurePerCountUnit: line.item!.measurePerCountUnit,
          measureUnit: line.item!.measureUnit
        }))
    );
    // Worst line per item — an item counted wrongly three times is one problem.
    const badCountByItem = new Map<string, (typeof badCounts)[number]>();
    for (const bad of badCounts) {
      const existing = badCountByItem.get(bad.itemId);
      if (!existing || bad.lineValueCents > existing.lineValueCents) badCountByItem.set(bad.itemId, bad);
    }

    const staleDays = options.staleDays ?? 180;
    const staleCutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);

    const flagged: StockConfigHealthItem[] = [];
    for (const item of items) {
      const issues: StockConfigHealthIssue[] = [];
      const costUnit = item.countUnit ?? item.unit;
      const recipeIds = new Set(item.recipeLines.map((line) => line.recipe.id));
      const recipeCount = recipeIds.size;

      // 1. No average cost → reads as $0 wherever it's used.
      // A stored ZERO is the same defect as a null and was not being reported:
      // six kitchen items (Lemon, Fennel, Ginger, Apples Granny Smith, Shiitake
      // punnets, black peppercorns) sit at 0 and valued a real count at $0.00
      // while passing this check.
      if (item.avgCostCents === null || item.avgCostCents === 0) {
        issues.push({
          code: 'no-avg-cost',
          severity: recipeCount > 0 ? 'error' : 'warn',
          message:
            recipeCount > 0
              ? `No average cost yet — the ${recipeCount} recipe${recipeCount === 1 ? '' : 's'} using this item cost it at $0. Receive it on an invoice or set an average cost.`
              : item.latestCostCents !== null
                ? 'A latest cost is set but no average cost — recipes and stock value still read $0. Receive it on an invoice to set the average.'
                : 'No cost on record — counts as $0 in stock value. Receive it on an invoice or set a cost.'
        });
      }

      // 2. Recipe lines whose unit can't convert to this item's cost unit — the
      //    exact case that used to mis-cost. Name the recipes to fix.
      const mismatchRecipes = new Map<string, string>();
      for (const line of item.recipeLines) {
        if (line.quantity === null || line.quantity === undefined) continue;
        const { via } = convertQuantityToCostUnit(line.quantity, line.unit, item);
        if (via === 'unknown') mismatchRecipes.set(line.recipe.id, line.recipe.title);
      }
      if (mismatchRecipes.size > 0) {
        const titles = Array.from(mismatchRecipes.values());
        const shown = titles.slice(0, 3).join(', ');
        const extra = titles.length > 3 ? ` +${titles.length - 3} more` : '';
        issues.push({
          code: 'recipe-unit-mismatch',
          severity: 'error',
          message: `A recipe unit can't convert to this item's cost unit (“${costUnit}”) in: ${shown}${extra}. Set a pack size or measure-per-unit on this item, or fix the recipe line's unit — until then those lines cost $0.`
        });
      }

      // 3. Measure bridge half-configured (one of the pair set without the other).
      const hasMeasureAmount = item.measurePerCountUnit !== null && item.measurePerCountUnit !== undefined;
      const hasMeasureUnit = Boolean(item.measureUnit && item.measureUnit.trim());
      if (hasMeasureAmount !== hasMeasureUnit) {
        issues.push({
          code: 'measure-half-set',
          severity: 'warn',
          message: hasMeasureAmount
            ? `Measure-per-unit amount is set but its unit (g or mL) isn't — the bridge won't work until both are set.`
            : `Measure unit is set but the amount (e.g. how many ${item.measureUnit} in one ${costUnit}) isn't — set the amount to enable it.`
        });
      }

      // 4. Stale cost — the figure is real but old, so margins drift quietly.
      if (item.avgCostCents !== null && item.latestCostAt && item.latestCostAt < staleCutoff) {
        const ageDays = Math.round((Date.now() - item.latestCostAt.getTime()) / (24 * 60 * 60 * 1000));
        issues.push({
          code: 'stale-cost',
          severity: 'warn',
          message: `Cost hasn't been updated in ${ageDays} days — margins may be drifting. Re-import a recent invoice for this item.`
        });
      }

      // 4. A counted quantity that cannot mean what its unit says.
      const badCount = badCountByItem.get(item.id);
      if (badCount) {
        issues.push({
          code: 'count-out-of-scale',
          severity: 'error',
          message: badCount.message
        });
      }

      if (issues.length === 0) continue;

      const onHandValueCents = item.avgCostCents !== null ? Math.round(item.onHand * item.avgCostCents) : null;
      flagged.push({
        id: item.id,
        name: item.name,
        categoryName: item.category?.name ?? null,
        unit: item.unit,
        countUnit: item.countUnit,
        recipeCount,
        onHand: item.onHand,
        onHandValueCents,
        topSeverity: issues.some((issue) => issue.severity === 'error') ? 'error' : 'warn',
        issues
      });
    }

    // Worst first: errors before warnings, then most recipes affected, then most
    // on-hand value at stake, then name.
    flagged.sort((a, b) => {
      if (a.topSeverity !== b.topSeverity) return a.topSeverity === 'error' ? -1 : 1;
      if (a.recipeCount !== b.recipeCount) return b.recipeCount - a.recipeCount;
      const av = a.onHandValueCents ?? 0;
      const bv = b.onHandValueCents ?? 0;
      if (av !== bv) return bv - av;
      return a.name.localeCompare(b.name);
    });

    return {
      generatedAt: new Date().toISOString(),
      totalActiveItems: items.length,
      flaggedCount: flagged.length,
      errorItemCount: flagged.filter((item) => item.topSeverity === 'error').length,
      warnItemCount: flagged.filter((item) => item.topSeverity === 'warn').length,
      items: flagged.slice(0, 300)
    };
  }
};
