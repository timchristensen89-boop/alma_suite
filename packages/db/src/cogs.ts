import { prisma } from './prisma.js';
import {
  computeActualCogsWith,
  stockValueAtCentsWith,
  type ActualCogs,
  type CogsReader
} from './cogs-core.js';

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
//     stocktake taken within STOCKTAKE_BRACKET_TOLERANCE_DAYS of each boundary
//     brackets the period, COGS = opening + purchases − closing (true accrual;
//     captures wastage/shrinkage automatically). Otherwise purchases only,
//     with `quality` and `reasons` saying which bracket failed and why.
//
// The rules and arithmetic live in cogs-core.ts (pure, tested against a fake
// reader); this file is the Prisma reader plus the exported entry points.
//
// This is theoretical COGS's counterpart, NOT a replacement for it: recipe-cost
// × units-sold (menu profitability, set-menu costing) stays separate on purpose
// — that's the theoretical side of the theoretical-vs-actual variance.

export type { ActualCogs, CogsSource, CogsQuality, StockBracket, StockBracketStatus, CogsReader } from './cogs-core.js';
export { computeActualCogsWith, stockValueAtCentsWith, stockBracket, venueStockBracket, unattributedCogs } from './cogs-core.js';

const FINALISED_COUNT_STATUSES = ['SUBMITTED', 'REVIEWED', 'LOCKED'] as const;

// Finalised, stock-relevant supplier invoices only.
const FINALISED_STOCK_INVOICE_WHERE = {
  status: { not: 'DRAFT' },
  triageStatus: { not: 'NO_ITEM' }
} as const;

const venueWhere = (venue: string | null | undefined) => (venue ? { venue } : {});

// Per-invoice subtotal→total fallback (a Prisma _sum can't fall back per row,
// and a mix of present/absent subtotals would otherwise undercount).
async function sumInvoices(where: Record<string, unknown>): Promise<{ cents: number; invoices: number }> {
  const invoices = await prisma.supplierInvoice.findMany({ where, select: { subtotalCents: true, totalCents: true } });
  let cents = 0;
  for (const invoice of invoices) cents += invoice.subtotalCents || invoice.totalCents || 0;
  return { cents, invoices: invoices.length };
}

export const prismaCogsReader: CogsReader = {
  async latestFinalisedCount(venue, at) {
    return prisma.stocktake.findFirst({
      where: { countedAt: { lte: at }, status: { in: [...FINALISED_COUNT_STATUSES] }, venue },
      orderBy: { countedAt: 'desc' },
      select: { countedAt: true }
    });
  },
  async finalisedCountIdsBetween(venue, window, at) {
    const rows = await prisma.stocktake.findMany({
      where: { countedAt: { gte: window.gte, lt: window.lt, lte: at }, status: { in: [...FINALISED_COUNT_STATUSES] }, venue },
      select: { id: true }
    });
    return rows.map((row) => row.id);
  },
  async lineValueCents(stocktakeIds) {
    const agg = await prisma.stocktakeLine.aggregate({
      where: { stocktakeId: { in: stocktakeIds } },
      _sum: { stockValueCents: true }
    });
    return agg._sum.stockValueCents ?? 0;
  },
  async venuesWithFinalisedCounts(at) {
    // Untagged (venue-null) counts are excluded: a whole-business count would
    // double-count against the per-venue counts it overlaps.
    const rows = await prisma.stocktake.findMany({
      where: { countedAt: { lte: at }, status: { in: [...FINALISED_COUNT_STATUSES] }, venue: { not: null } },
      distinct: ['venue'],
      select: { venue: true }
    });
    return rows.map((row) => row.venue as string);
  },
  async purchasesExGstCents(venue, start, end) {
    const { cents } = await sumInvoices({
      invoiceDate: { gte: start, lt: end },
      ...FINALISED_STOCK_INVOICE_WHERE,
      ...venueWhere(venue)
    });
    return cents;
  },
  async unattributedPurchases(start, end) {
    return sumInvoices({ invoiceDate: { gte: start, lt: end }, ...FINALISED_STOCK_INVOICE_WHERE, venue: null });
  }
};

// Value of the latest valid finalised stocktake on or before `at` — the
// canonical "stock on hand" valuation. Null when no count within tolerance
// brackets the boundary, or (all venues) when any venue that has counted has
// no valid count, so a missing venue never reads as zero stock.
export async function stockValueAtCents(venue: string | null, at: Date): Promise<number | null> {
  return stockValueAtCentsWith(prismaCogsReader, venue, at);
}

// Ex-GST finalised stock purchases in [start, end).
export async function purchasesExGstCents(venue: string | null, start: Date, end: Date): Promise<number> {
  return prismaCogsReader.purchasesExGstCents(venue, start, end);
}

// THE canonical actual-COGS figure for a venue (or all venues when null) over
// [start, end). Every surface that shows a COGS dollar value or COGS % must run
// through this so the suite agrees with itself.
export async function computeActualCogs(params: { venue: string | null; start: Date; end: Date }): Promise<ActualCogs> {
  return computeActualCogsWith(prismaCogsReader, params);
}
