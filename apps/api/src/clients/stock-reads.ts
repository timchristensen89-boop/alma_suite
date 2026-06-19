/**
 * Stock reads adapter (feature-flagged).
 *
 * The migration seam for moving suite reads off direct `prisma.<stockModel>`
 * access and onto the Stock API. It centralizes the rollout flag so consumers
 * can flip read-by-read, in shadow mode, with a safe default.
 *
 * Pattern at the call site (default-OFF keeps current behaviour byte-for-byte):
 *
 *   const items = useStockApiReads
 *     ? await stockReads.activeItems({ authToken })
 *     : await prisma.stockItem.findMany({ where: { status: 'ACTIVE' }, ... });
 *
 * When `USE_STOCK_API_READS=1`, the read goes through stock-api instead. Run
 * both in parallel and diff before flipping a venue (see SEPARATION_PLAN Phase 1).
 *
 * NOTE: this adapter does NOT import any stock Prisma model — that is the whole
 * point. Response normalization to the shape each consumer expects lives here,
 * per-consumer, and must be verified against a running stock-api before the flag
 * is enabled for that read.
 */
import { stockClient, type StockClientOptions } from './stock-client.js';
import type { ReportsStockSummary } from '@alma/shared';

/** Global rollout flag. Off by default — current Prisma paths stay in effect. */
export const useStockApiReads =
  process.env.USE_STOCK_API_READS === '1' || process.env.USE_STOCK_API_READS === 'true';

/**
 * The exact item shape the manager dashboard consumes (staff.service
 * getManagerDashboard → lowStock). Normalizing to this guarantees the flag-ON
 * path is byte-compatible with the existing Prisma read regardless of stock-api
 * payload drift.
 */
export interface StockItemForDashboard {
  id: string;
  name: string;
  unit: string;
  onHand: number;
  parLevel: number;
  reorderPoint: number;
  category: { name: string } | null;
}

export const stockReads = {
  /**
   * Active items normalized for the manager dashboard — replaces
   * `prisma.stockItem.findMany({ where: { status: 'ACTIVE' }, include: { category } })`.
   * Reads `payload.items` from GET /api/items and keeps only ACTIVE rows.
   */
  async activeItems(opts?: StockClientOptions): Promise<StockItemForDashboard[]> {
    const payload = (await stockClient.listItems({}, opts)) as {
      items?: Array<Record<string, any>>;
    };
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return items
      .filter((i) => i?.status === undefined || i?.status === 'ACTIVE')
      .map((i) => ({
        id: String(i.id),
        name: String(i.name ?? ''),
        unit: String(i.unit ?? ''),
        onHand: Number(i.onHand ?? 0),
        parLevel: Number(i.parLevel ?? 0),
        reorderPoint: Number(i.reorderPoint ?? 0),
        category: i.category ? { name: String(i.category.name ?? '') } : null
      }));
  },

  /** Cost-of-goods for a venue/window — replaces direct invoice/recipe COGS reads. */
  costOfGoods(params: { venue?: string; days?: number } = {}, opts?: StockClientOptions) {
    return stockClient.costOfGoods(params, opts);
  },

  /** Stocktakes — replaces `prisma.stocktake.findMany(...)`. */
  stocktakes(opts?: StockClientOptions) {
    return stockClient.listStocktakes(opts);
  },

  /**
   * Count of ACTIVE catalogue items — replaces
   * `prisma.stockItem.count({ where: { status: 'ACTIVE' } })` (reports stock summary).
   * Uses /api/items/summary's `activeItems` (a global, non-venue-scoped count,
   * matching the report's query).
   */
  async activeItemCount(opts?: StockClientOptions): Promise<number> {
    const summary = (await stockClient.itemsSummary({}, opts)) as { activeItems?: number };
    return Number(summary?.activeItems ?? 0);
  },

  /**
   * Recipe cost inputs — replaces
   * `prisma.recipe.findMany({ select: { id, estimatedCost, yieldQuantity, portionSize } })`
   * (reports per-portion COGS). Nullable fields preserved as null.
   */
  async recipeCosts(opts?: StockClientOptions): Promise<RecipeCostRow[]> {
    const payload = (await stockClient.listRecipes({}, opts)) as { recipes?: Array<Record<string, any>> };
    const recipes = Array.isArray(payload?.recipes) ? payload.recipes : [];
    return recipes.map((r) => ({
      id: String(r.id),
      estimatedCost: Number(r.estimatedCost ?? 0),
      yieldQuantity: r.yieldQuantity == null ? null : Number(r.yieldQuantity),
      portionSize: r.portionSize == null ? null : Number(r.portionSize)
    }));
  },

  /**
   * Wastage in a date range for prime-cost — replaces
   * `prisma.stockWastageRecord.findMany({ where: { wastedAt: { gte, lt }, venue } })`.
   * Uses the dedicated /operations/wastage-report feed (all reasons, uncapped).
   */
  async wastageInRange(
    params: { venue?: string; from?: string; to?: string },
    opts?: StockClientOptions
  ): Promise<WastageRow[]> {
    const rows = await stockClient.wastageReport(params, opts);
    return (rows ?? []).map((r) => ({
      venue: String(r.venue),
      costImpactCents: r.costImpactCents == null ? null : Number(r.costImpactCents)
    }));
  },

  /**
   * Per-venue stocktake status — replaces reports.service.stocktakeStatus's
   * direct stocktake reads. The computation is ported into stock-api; this is a
   * passthrough of /stocktake/venue-status.
   */
  async venueStocktakeStatus(
    params: { venue?: string } = {},
    opts?: StockClientOptions
  ): Promise<VenueStocktakeStatusPayload> {
    return (await stockClient.stocktakeVenueStatus(params, opts)) as VenueStocktakeStatusPayload;
  },

  /**
   * Full stock summary block — replaces reports.service.buildStockSummary's direct
   * reads (#1 venue on-hand, #3 low/out-of-stock, #4 ready-for-review count,
   * #5 recently-submitted review cards, #6 highest variance). Computation ported
   * into stock-api; this is a passthrough of /stocktake/stock-summary.
   */
  async stockSummary(
    params: { venue?: string | null; since: string },
    opts?: StockClientOptions
  ): Promise<ReportsStockSummary> {
    return (await stockClient.stockSummary(
      { venue: params.venue || undefined, since: params.since },
      opts
    )) as ReportsStockSummary;
  },

  /**
   * COGS invoice lines in a date range — replaces the prime-cost
   * `prisma.supplierInvoiceLine.findMany(... invoice in range)` read (#7).
   * Re-nests to the consumer's `{ invoice: { venue }, lineAmountCents }` shape.
   */
  async cogsLinesInRange(
    params: { venue?: string; from?: string; to?: string },
    opts?: StockClientOptions
  ): Promise<Array<{ invoice: { venue: string | null }; lineAmountCents: number }>> {
    const rows = await stockClient.cogsLines(params, opts);
    return (rows ?? []).map((r) => ({
      invoice: { venue: r.venue ?? null },
      lineAmountCents: Number(r.lineAmountCents ?? 0)
    }));
  }
};

export interface VenueStocktakeStatusPayload {
  generatedAt: string;
  staleDays: number;
  venues: Array<{
    venue: string;
    latestLocked: {
      id: string;
      name: string | null;
      countedAt: string;
      lockedAt: string | null;
      lineCount: number;
      stockValueCents: number | null;
      stale: boolean;
    } | null;
    latestAny: { id: string; name: string | null; status: string; countedAt: string } | null;
    quality: string;
  }>;
}

export interface RecipeCostRow {
  id: string;
  estimatedCost: number;
  yieldQuantity: number | null;
  portionSize: number | null;
}

export interface WastageRow {
  venue: string;
  costImpactCents: number | null;
}

export type StockReads = typeof stockReads;
