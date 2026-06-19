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
  }
};

export type StockReads = typeof stockReads;
