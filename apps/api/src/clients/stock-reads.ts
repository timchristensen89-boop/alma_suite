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

export const stockReads = {
  /** Active items with category — replaces `prisma.stockItem.findMany({where:{status:'ACTIVE'}})`. */
  async activeItems(opts?: StockClientOptions): Promise<unknown[]> {
    const items = (await stockClient.listItems({}, opts)) as Array<Record<string, unknown>>;
    // stock-api may already scope to ACTIVE; filter defensively until shapes are unified.
    return items.filter((i) => i?.status === undefined || i?.status === 'ACTIVE');
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
