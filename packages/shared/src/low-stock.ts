/**
 * The one definition of "low stock" for a venue-stock row, shared by the
 * Stock dashboard headline, its "Needs attention" table, the /low-stock and
 * reorder endpoints, and the Reports stock summary.
 *
 * Background: the dashboard headline counted every venue-stock row while the
 * table beside it looked only at the 200 most recently updated rows before
 * filtering — 581 low items next to "No low-stock items right now". Five
 * surfaces also carried five slightly different threshold rules (one skipped
 * the item-level reorder point, one treated a never-counted row as zero).
 *
 * Rules:
 *  - threshold = venue reorder point → venue par → item reorder point →
 *    item par. A row with no positive threshold is never "low".
 *  - low = counted (onHand not null) and at or under the threshold.
 *  - out of stock = counted and at or under zero. This is deliberately
 *    independent of the threshold: an item with no par set can still be out.
 *  - needs attention = low OR out of stock — what the drill-down table shows.
 *  - inactive rows and archived items are outside every count.
 */

export type LowStockRowInput = {
  onHand: number | null;
  reorderPoint: number | null;
  parLevel: number | null;
  /** VenueStockItem.active; defaults to true when the row has no flag. */
  active?: boolean;
  stockItem: {
    /** StockItem.status; defaults to ACTIVE when the query already filtered on it. */
    status?: string;
    reorderPoint: number | null;
    parLevel: number | null;
  };
};

export function effectiveLowStockThreshold(row: LowStockRowInput): number {
  return row.reorderPoint ?? row.parLevel ?? row.stockItem.reorderPoint ?? row.stockItem.parLevel ?? 0;
}

function isTracked(row: LowStockRowInput): boolean {
  return (row.active ?? true) && (row.stockItem.status ?? 'ACTIVE') === 'ACTIVE' && row.onHand !== null;
}

export function isLowStockRow(row: LowStockRowInput): boolean {
  if (!isTracked(row)) return false;
  const threshold = effectiveLowStockThreshold(row);
  return threshold > 0 && (row.onHand as number) <= threshold;
}

export function isOutOfStockRow(row: LowStockRowInput): boolean {
  return isTracked(row) && (row.onHand as number) <= 0;
}

export function needsStockAttention(row: LowStockRowInput): boolean {
  return isLowStockRow(row) || isOutOfStockRow(row);
}

export type LowStockStatus = 'OUT_OF_STOCK' | 'LOW_STOCK' | 'BELOW_PAR';

/** The badge for a row that needs attention, with the action it suggests. */
export function lowStockStatus(row: LowStockRowInput): { stockStatus: LowStockStatus; suggestedAction: string } {
  const onHand = row.onHand ?? 0;
  if (onHand <= 0) return { stockStatus: 'OUT_OF_STOCK', suggestedAction: 'Out of stock' };
  const reorderPoint = row.reorderPoint ?? row.stockItem.reorderPoint;
  if (reorderPoint !== null && reorderPoint > 0 && onHand <= reorderPoint) {
    return { stockStatus: 'LOW_STOCK', suggestedAction: 'Order soon' };
  }
  return { stockStatus: 'BELOW_PAR', suggestedAction: 'Below par' };
}

/**
 * Sort key for an attention list: out of stock first, then by how far under
 * the threshold the row sits (0 = at the line, 1 = empty), so the ten rows
 * shown are the ten that most need ordering — not the ten touched most
 * recently, which is how a busy stocktake hid every low row.
 */
export function lowStockSeverity(row: LowStockRowInput): number {
  const onHand = row.onHand ?? 0;
  if (onHand <= 0) return 2;
  const threshold = effectiveLowStockThreshold(row);
  if (threshold <= 0) return 0;
  return Math.max(0, Math.min(1, (threshold - onHand) / threshold));
}

export function rankStockAttentionRows<T extends LowStockRowInput>(rows: T[]): T[] {
  return rows
    .filter(needsStockAttention)
    .map((row, index) => ({ row, index, severity: lowStockSeverity(row) }))
    .sort((a, b) => b.severity - a.severity || a.index - b.index)
    .map((entry) => entry.row);
}

export type LowStockSummary = {
  lowStockItems: number;
  outOfStockItems: number;
  /** Rows the attention table would show: low OR out of stock. */
  attentionItems: number;
};

export function summariseLowStock(rows: LowStockRowInput[]): LowStockSummary {
  let lowStockItems = 0;
  let outOfStockItems = 0;
  let attentionItems = 0;
  for (const row of rows) {
    const low = isLowStockRow(row);
    const out = isOutOfStockRow(row);
    if (low) lowStockItems += 1;
    if (out) outOfStockItems += 1;
    if (low || out) attentionItems += 1;
  }
  return { lowStockItems, outOfStockItems, attentionItems };
}
