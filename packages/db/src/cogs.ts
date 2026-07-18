import { prisma } from './prisma.js';

// ── Single source of truth for "actual" (financial) Cost of Goods Sold ──────
//
// Before this existed, three surfaces each computed COGS their own way and
// disagreed: the Stock dashboard summed ex-GST invoice subtotals (incl. DRAFTs,
// no stock bounds), the Monthly Recap did opening+purchases−closing on inc-GST
// totals, and the Prime Cost report summed itemised invoice *lines* plus
// wastage. Same period, three numbers.
//
// Canonical definition (agreed with the owner):
//   • Ex-GST — purchases use each invoice's subtotal (net of GST), falling back
//     to the total only when a subtotal wasn't parsed. GST is claimable, so it
//     isn't a cost of goods.
//   • Finalised stock purchases only — status ≠ DRAFT AND triageStatus ≠ NO_ITEM
//     (NO_ITEM = a document excluded by the stock-import rules, e.g. rent), so a
//     draft or a non-stock bill never lands in COGS.
//   • Stocktake-bounded with a purchases-only fallback — when a finalised
//     stocktake brackets both ends of the period, COGS = opening + purchases −
//     closing (true accrual; captures wastage/shrinkage automatically). When a
//     boundary stocktake is missing, fall back to purchases only and flag it.
//
// This is theoretical COGS's counterpart, NOT a replacement for it: recipe-cost
// × units-sold (menu profitability, set-menu costing) stays separate on purpose
// — that's the theoretical side of the theoretical-vs-actual variance.

export type CogsSource = 'stock_bounded' | 'purchases_only';

// 'complete' = both stocktake bounds present. The others say which bound was
// missing, so callers can surface "COGS is estimated" honestly.
export type CogsQuality = 'complete' | 'estimated' | 'missing_opening' | 'missing_closing' | 'closing_implausible';

export type ActualCogs = {
  cogsCents: number;
  purchasesCents: number;
  openingStockCents: number;
  closingStockCents: number;
  openingStockAvailable: boolean;
  closingStockAvailable: boolean;
  source: CogsSource;
  quality: CogsQuality;
};

// Finalised, stock-relevant supplier invoices only.
const FINALISED_STOCK_INVOICE_WHERE = {
  status: { not: 'DRAFT' },
  triageStatus: { not: 'NO_ITEM' }
} as const;

const venueWhere = (venue: string | null | undefined) => (venue ? { venue } : {});

// Total value of the latest finalised stocktake on or before `at` — the
// canonical "stock on hand" valuation. Returns null when no stocktake brackets
// the boundary, which is what drives the purchases-only fallback above.
//
// Stock is counted PER VENUE, so the all-venues valuation (venue == null) must
// SUM the latest count of each venue, not take the single most-recent stocktake
// (which belongs to just one venue and silently ignores the others). Untagged
// (venue-null) counts are excluded from the all-venues sum: a whole-business
// count would double-count against the per-venue counts it overlaps.
export async function stockValueAtCents(venue: string | null, at: Date): Promise<number | null> {
  if (venue == null) {
    const venueRows = await prisma.stocktake.findMany({
      where: { countedAt: { lte: at }, status: { in: ['SUBMITTED', 'REVIEWED', 'LOCKED'] }, venue: { not: null } },
      distinct: ['venue'],
      select: { venue: true }
    });
    const values = await Promise.all(venueRows.map((row) => stockValueForVenueAtCents(row.venue as string, at)));
    const present = values.filter((value): value is number => value != null);
    if (present.length === 0) return null;
    return present.reduce((sum, value) => sum + value, 0);
  }
  return stockValueForVenueAtCents(venue, at);
}

// Value of a single venue's latest finalised stocktake on or before `at`.
async function stockValueForVenueAtCents(venue: string, at: Date): Promise<number | null> {
  const stocktake = await prisma.stocktake.findFirst({
    where: { countedAt: { lte: at }, status: { in: ['SUBMITTED', 'REVIEWED', 'LOCKED'] }, venue },
    orderBy: { countedAt: 'desc' },
    select: { id: true }
  });
  if (!stocktake) return null;
  const agg = await prisma.stocktakeLine.aggregate({
    where: { stocktakeId: stocktake.id },
    _sum: { stockValueCents: true }
  });
  return agg._sum.stockValueCents ?? 0;
}

// Ex-GST finalised stock purchases in [start, end). Per-invoice subtotal→total
// fallback (a Prisma _sum can't fall back per row, and a mix of present/absent
// subtotals would otherwise undercount).
export async function purchasesExGstCents(venue: string | null, start: Date, end: Date): Promise<number> {
  const invoices = await prisma.supplierInvoice.findMany({
    where: {
      invoiceDate: { gte: start, lt: end },
      ...FINALISED_STOCK_INVOICE_WHERE,
      ...venueWhere(venue)
    },
    select: { subtotalCents: true, totalCents: true }
  });
  let cents = 0;
  for (const invoice of invoices) {
    cents += invoice.subtotalCents || invoice.totalCents || 0;
  }
  return cents;
}

// THE canonical actual-COGS figure for a venue (or all venues when null) over
// [start, end). Every surface that shows a COGS dollar value or COGS % must run
// through this so the suite agrees with itself.
export async function computeActualCogs(params: {
  venue: string | null;
  start: Date;
  end: Date;
}): Promise<ActualCogs> {
  const { venue, start, end } = params;
  const [purchasesCents, opening, closing] = await Promise.all([
    purchasesExGstCents(venue, start, end),
    stockValueAtCents(venue, start),
    // Closing uses lte:end so a stocktake taken exactly at the boundary (this
    // period's close, next period's open) is included, not lost to an off-by-1ms.
    stockValueAtCents(venue, end)
  ]);

  const openingStockCents = opening ?? 0;
  const closingStockCents = closing ?? 0;

  if (opening != null && closing != null) {
    const rawCogsCents = openingStockCents + purchasesCents - closingStockCents;
    // Closing stock can't exceed what was on hand plus everything bought —
    // a negative COGS means the latest stocktake is mis-valued (almost always a
    // unit/pack error blowing up one high-value line). Don't silently clamp to
    // $0, which reads as "no cost of goods"; fall back to purchases and flag it
    // (the opening/closing values are still returned so callers can warn with
    // the actual figures).
    if (rawCogsCents < 0) {
      return {
        cogsCents: purchasesCents,
        purchasesCents,
        openingStockCents,
        closingStockCents,
        openingStockAvailable: true,
        closingStockAvailable: true,
        source: 'purchases_only',
        quality: 'closing_implausible'
      };
    }
    return {
      cogsCents: rawCogsCents,
      purchasesCents,
      openingStockCents,
      closingStockCents,
      openingStockAvailable: true,
      closingStockAvailable: true,
      source: 'stock_bounded',
      quality: 'complete'
    };
  }

  return {
    cogsCents: purchasesCents,
    purchasesCents,
    openingStockCents,
    closingStockCents,
    openingStockAvailable: opening != null,
    closingStockAvailable: closing != null,
    source: 'purchases_only',
    quality: opening == null && closing == null ? 'estimated' : opening == null ? 'missing_opening' : 'missing_closing'
  };
}
