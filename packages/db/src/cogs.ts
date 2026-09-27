import { prisma } from './prisma.js';
import { STOCKTAKE_BOUNDARY_WINDOW_DAYS, assessStocktakeValuation, realVenueNames } from '@alma/shared';
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
//   • Stocktake-bounded with a purchases-only fallback — when each boundary
//     carries a complete, valued count of known scope (one COMBINED count, or
//     a FOOD + BEVERAGE pair) within STOCKTAKE_BOUNDARY_WINDOW_DAYS (±7),
//     COGS = opening + purchases − closing (true accrual; captures
//     wastage/shrinkage automatically). Otherwise purchases only, with
//     `quality` and `reasons` saying which boundary failed and why.
//
// The rules and arithmetic live in cogs-core.ts (pure, tested against a fake
// reader); this file is the Prisma reader plus the exported entry points.
//
// This is theoretical COGS's counterpart, NOT a replacement for it: recipe-cost
// × units-sold (menu profitability, set-menu costing) stays separate on purpose
// — that's the theoretical side of the theoretical-vs-actual variance.

export type {
  ActualCogs, CogsSource, CogsQuality, StockBracket, StockBracketStatus, CogsReader, OffVenueCount, ScopedCount, BracketComponent, RejectedCount, RejectedCountReason, VenueShort
} from './cogs-core.js';
export { computeActualCogsWith, stockValueAtCentsWith, stockBracket, venueStockBracket, unattributedCogs, partitionCountLabels, composeBoundary } from './cogs-core.js';

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

// Stored labels are matched exactly; '' stands for a null venue.
const labelWhere = (labels: string[]) => {
  const named = labels.filter((l) => l !== '');
  const includesNull = labels.includes('');
  if (named.length && includesNull) return { OR: [{ venue: { in: named } }, { venue: null }] };
  if (includesNull) return { venue: null };
  return { venue: { in: named } };
};

export const prismaCogsReader: CogsReader = {
  async configuredVenues() {
    // Settings › Venues (AppSettings.venues, the list the admin maintains
    // and every report reads for targets) is the canonical population. The
    // Venue table is a fallback only: on the production database it holds
    // no rows (validation, 27 Sep 2026), so reading it alone made every
    // count off-venue. Pseudo markers never count as venues.
    const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { venues: true } });
    const fromSettings = Array.isArray(settings?.venues)
      ? realVenueNames(
          (settings.venues as unknown[]).map((v) => (typeof v === 'object' && v !== null && typeof (v as { name?: unknown }).name === 'string' ? (v as { name: string }).name : null))
        )
      : [];
    if (fromSettings.length > 0) return fromSettings;
    const rows = await prisma.venue.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
    return realVenueNames(rows.map((row) => row.name));
  },
  async storedCountVenueLabels(at) {
    const rows = await prisma.stocktake.findMany({
      where: { countedAt: { lte: at }, status: { in: [...FINALISED_COUNT_STATUSES] } },
      distinct: ['venue'],
      select: { venue: true }
    });
    return rows.map((row) => row.venue ?? '');
  },
  async finalisedCountsNear(labels, window) {
    const rows = await prisma.stocktake.findMany({
      where: { countedAt: { gte: window.gte, lte: window.lte }, status: { in: [...FINALISED_COUNT_STATUSES] }, ...labelWhere(labels) },
      select: {
        id: true,
        name: true,
        countedAt: true,
        scope: true,
        lines: { select: { itemId: true, recipeId: true, countedQty: true, stockValueCents: true } }
      },
      orderBy: { countedAt: 'asc' }
    });
    return rows.map((row) => ({ id: row.id, name: row.name, countedAt: row.countedAt, scope: row.scope, valuation: assessStocktakeValuation(row.lines) }));
  },
  async countsUnderLabels(labels, at) {
    const rows = await prisma.stocktake.findMany({
      where: { countedAt: { lte: at }, status: { in: [...FINALISED_COUNT_STATUSES] }, ...labelWhere(labels) },
      select: { venue: true, countedAt: true, lines: { select: { stockValueCents: true } } },
      orderBy: { countedAt: 'desc' }
    });
    return rows.map((row) => ({
      label: row.venue ?? '',
      countedAt: row.countedAt,
      valueCents: row.lines.reduce((sum, line) => sum + (line.stockValueCents ?? 0), 0)
    }));
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

// Value of the latest complete count within `windowDays` of `at` — the
// canonical "stock on hand" valuation. Null when no complete composition
// sits inside the window, or (all venues) when any configured venue has
// none, so a missing venue never reads as zero stock. Operational tiles pass
// their own freshness window; period boundaries use the default.
export async function stockValueAtCents(venue: string | null, at: Date, windowDays = STOCKTAKE_BOUNDARY_WINDOW_DAYS): Promise<number | null> {
  return stockValueAtCentsWith(prismaCogsReader, venue, at, windowDays);
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
