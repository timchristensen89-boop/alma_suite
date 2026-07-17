/**
 * Stock summary for suite reports.
 *
 * Ported verbatim from the suite's reports.service.buildStockSummary so the
 * suite can delegate here instead of reading stock tables directly. Clears
 * reports reads #1 (venue on-hand lookup), #3 (low/out-of-stock), #4 (ready for
 * review count), #5 (recently-submitted review cards), #6 (highest variance).
 *
 * Pure read-only. `venue` is the already-resolved venue scope (string = one
 * venue, null = all); `sinceISO` is the window start for "recently submitted".
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import type { ReportsStockSummary, StocktakeReviewItem } from '@alma/shared';

function stocktakeLineValue(lines: Array<{ stockValueCents: number | null }>) {
  return lines.reduce((sum, line) => sum + (line.stockValueCents ?? 0), 0);
}

async function venueOnHandLookup(
  rows: Array<{ venue: string | null; lines: Array<{ item: { id: string } | null }> }>
) {
  const venues = Array.from(
    new Set(rows.map((row) => row.venue?.trim()).filter((venue): venue is string => Boolean(venue)))
  );
  const itemIds = Array.from(
    new Set(rows.flatMap((row) => row.lines.flatMap((line) => (line.item?.id ? [line.item.id] : []))))
  );
  if (venues.length === 0 || itemIds.length === 0) {
    return new Map<string, number | null>();
  }
  const venueRows = await prisma.venueStockItem.findMany({
    where: { venue: { in: venues }, stockItemId: { in: itemIds } },
    select: { venue: true, stockItemId: true, onHand: true }
  });
  return new Map(venueRows.map((row) => [`${row.venue}:${row.stockItemId}`, row.onHand] as const));
}

function toStocktakeReviewPayload(
  row: Prisma.StocktakeGetPayload<{
    include: {
      _count: { select: { lines: true } };
      lines: { select: { countedQty: true; stockValueCents: true; item: { select: { id: true; onHand: true } } } };
    };
  }>,
  venueOnHandByKey?: Map<string, number | null>
): StocktakeReviewItem {
  const variance = row.lines.reduce(
    (summary, line) => {
      if (!line.item || line.countedQty == null) return summary;
      const venueOnHand = row.venue ? venueOnHandByKey?.get(`${row.venue}:${line.item.id}`) : undefined;
      const onHand = venueOnHand ?? line.item.onHand;
      const delta = line.countedQty - onHand;
      if (Math.abs(delta) > 0.0001) summary.varianceLineCount += 1;
      summary.totalVarianceQuantity += delta;
      if (delta > 0) summary.positiveVarianceQuantity += delta;
      if (delta < 0) summary.negativeVarianceQuantity += delta;
      return summary;
    },
    { varianceLineCount: 0, totalVarianceQuantity: 0, positiveVarianceQuantity: 0, negativeVarianceQuantity: 0 }
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
  } as StocktakeReviewItem;
}

export const stockReportsService = {
  async buildStockSummary(params: { venue?: string | null; sinceISO: string }): Promise<ReportsStockSummary> {
    const venue = params.venue?.trim() || null;
    const start = new Date(params.sinceISO);
    const venueFilter: Prisma.StocktakeWhereInput = venue ? { venue } : {};

    const [activeCatalogueItems, venueRows, stocktakesReadyForReview, recentlySubmittedStocktakes, highestVarianceRows] =
      await Promise.all([
        prisma.stockItem.count({ where: { status: 'ACTIVE' } }),
        prisma.venueStockItem.findMany({
          where: { ...(venue ? { venue } : {}), active: true, stockItem: { status: 'ACTIVE' } },
          include: { stockItem: { select: { parLevel: true, reorderPoint: true } } }
        }),
        prisma.stocktake.count({ where: { AND: [venueFilter, { status: 'SUBMITTED', appliedAt: null }] } }),
        prisma.stocktake.findMany({
          where: { AND: [venueFilter, { status: 'SUBMITTED', updatedAt: { gte: start } }] },
          include: {
            _count: { select: { lines: true } },
            lines: { select: { countedQty: true, stockValueCents: true, item: { select: { id: true, onHand: true } } } }
          },
          orderBy: [{ submittedAt: 'desc' }, { updatedAt: 'desc' }],
          take: 6
        }),
        prisma.stocktakeLine.findMany({
          where: {
            stocktake: { AND: [venueFilter, { status: 'SUBMITTED', updatedAt: { gte: start } }] },
            itemId: { not: null }
          },
          include: {
            stocktake: { select: { id: true, name: true, venue: true, submittedAt: true, updatedAt: true } },
            item: { select: { id: true, name: true, onHand: true, unit: true } }
          },
          take: 100
        })
      ]);

    const lowStockCount = venueRows.filter((row) => {
      const threshold = row.reorderPoint ?? row.parLevel ?? row.stockItem.parLevel;
      return row.onHand !== null && threshold > 0 && row.onHand <= threshold;
    }).length;
    const outOfStockCount = venueRows.filter((row) => row.onHand !== null && row.onHand <= 0).length;
    const venueStockOnHandByKey = new Map(
      venueRows.map((row) => [`${row.venue}:${row.stockItemId}`, row.onHand] as const)
    );
    const venueStockItemIds = new Set(venueRows.map((row) => row.stockItemId));
    const reviewVenueOnHandByKey = await venueOnHandLookup(recentlySubmittedStocktakes);

    const highestVarianceLines = highestVarianceRows
      .filter((line) => line.item)
      .map((line) => {
        const venueOnHand =
          line.stocktake.venue && line.item?.id
            ? venueStockOnHandByKey.get(`${line.stocktake.venue}:${line.item.id}`)
            : undefined;
        const onHand = venueOnHand ?? line.item?.onHand ?? 0;
        return {
          stocktakeId: line.stocktake.id,
          stocktakeName: line.stocktake.name,
          venue: line.stocktake.venue,
          itemName: line.item?.name ?? line.label,
          countedQty: line.countedQty,
          onHand,
          unit: line.unit ?? line.item?.unit ?? null,
          variance: line.countedQty == null ? null : line.countedQty - onHand,
          submittedAt: line.stocktake.submittedAt?.toISOString() ?? line.stocktake.updatedAt.toISOString()
        };
      })
      .filter((line) => line.variance != null && Math.abs(line.variance) > 0.0001)
      .sort((a, b) => Math.abs(b.variance ?? 0) - Math.abs(a.variance ?? 0))
      .slice(0, 8);

    return {
      activeStockItems: activeCatalogueItems,
      activeCatalogueItems,
      venueStockItems: venueStockItemIds.size,
      unconfiguredVenueStockItems: venue ? Math.max(activeCatalogueItems - venueStockItemIds.size, 0) : 0,
      lowStockCount,
      outOfStockCount,
      stocktakesReadyForReview,
      recentlySubmittedStocktakes: recentlySubmittedStocktakes.map((row) =>
        toStocktakeReviewPayload(row, reviewVenueOnHandByKey)
      ),
      highestVarianceLines,
      stockItemsVenueScoped: true
    };
  }
};
