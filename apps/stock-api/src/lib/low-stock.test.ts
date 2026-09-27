import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  effectiveLowStockThreshold,
  isLowStockRow,
  isOutOfStockRow,
  lowStockSeverity,
  lowStockStatus,
  rankStockAttentionRows,
  summariseLowStock
} from '@alma/shared';

const row = (over: Partial<{
  onHand: number | null;
  reorderPoint: number | null;
  parLevel: number | null;
  active: boolean;
  itemStatus: string;
  itemReorderPoint: number | null;
  itemParLevel: number | null;
  name: string;
}> = {}) => ({
  name: over.name ?? 'item',
  onHand: over.onHand === undefined ? 5 : over.onHand,
  reorderPoint: over.reorderPoint ?? null,
  parLevel: over.parLevel ?? null,
  active: over.active ?? true,
  stockItem: {
    status: over.itemStatus ?? 'ACTIVE',
    reorderPoint: over.itemReorderPoint ?? null,
    parLevel: over.itemParLevel ?? 0
  }
});

describe('threshold', () => {
  it('prefers venue reorder point, then venue par, then item reorder point, then item par', () => {
    assert.equal(effectiveLowStockThreshold(row({ reorderPoint: 3, parLevel: 8, itemReorderPoint: 4, itemParLevel: 9 })), 3);
    assert.equal(effectiveLowStockThreshold(row({ parLevel: 8, itemReorderPoint: 4, itemParLevel: 9 })), 8);
    // The Reports stock summary used to skip this level, so an item with only
    // an item-level reorder point was "low" on the dashboard and fine in Reports.
    assert.equal(effectiveLowStockThreshold(row({ itemReorderPoint: 4, itemParLevel: 9 })), 4);
    assert.equal(effectiveLowStockThreshold(row({ itemParLevel: 9 })), 9);
    assert.equal(effectiveLowStockThreshold(row()), 0);
  });
});

describe('isLowStockRow / isOutOfStockRow', () => {
  it('is low at or under a positive threshold, never without one', () => {
    assert.equal(isLowStockRow(row({ onHand: 6, parLevel: 6 })), true);
    assert.equal(isLowStockRow(row({ onHand: 7, parLevel: 6 })), false);
    assert.equal(isLowStockRow(row({ onHand: 0 })), false);
  });

  it('a never-counted row (onHand null) is neither low nor out — it is uncounted', () => {
    assert.equal(isLowStockRow(row({ onHand: null, parLevel: 6 })), false);
    assert.equal(isOutOfStockRow(row({ onHand: null, parLevel: 6 })), false);
  });

  it('out of stock does not need a par level', () => {
    assert.equal(isOutOfStockRow(row({ onHand: 0 })), true);
    assert.equal(isOutOfStockRow(row({ onHand: -2 })), true);
    assert.equal(isOutOfStockRow(row({ onHand: 1 })), false);
  });

  it('inactive rows and archived items are outside every count', () => {
    assert.equal(isLowStockRow(row({ onHand: 0, parLevel: 6, active: false })), false);
    assert.equal(isOutOfStockRow(row({ onHand: 0, itemStatus: 'ARCHIVED' })), false);
  });
});

describe('summariseLowStock and the attention table', () => {
  const rows = [
    row({ name: 'fine', onHand: 20, parLevel: 6 }),
    row({ name: 'low', onHand: 4, parLevel: 6 }),
    row({ name: 'empty-with-par', onHand: 0, parLevel: 6 }),
    row({ name: 'empty-no-par', onHand: 0 }),
    row({ name: 'uncounted', onHand: null, parLevel: 6 }),
    row({ name: 'nearly', onHand: 6, parLevel: 6 })
  ];

  it('the headline count and the drill-down are the same rows', () => {
    const summary = summariseLowStock(rows);
    const ranked = rankStockAttentionRows(rows);
    assert.deepEqual(summary, { lowStockItems: 3, outOfStockItems: 2, attentionItems: 4 });
    assert.equal(ranked.length, summary.attentionItems);
    // Everything low is in the table, so the headline can't say 581 while
    // the table says "none".
    assert.equal(rows.filter(isLowStockRow).every((r) => ranked.includes(r)), true);
  });

  it('ranks empties first, then by shortfall, keeping input order on ties', () => {
    const ranked = rankStockAttentionRows(rows).map((r) => r.name);
    assert.deepEqual(ranked, ['empty-with-par', 'empty-no-par', 'low', 'nearly']);
    assert.equal(lowStockSeverity(row({ onHand: 0, parLevel: 6 })), 2);
    assert.equal(lowStockSeverity(row({ onHand: 3, parLevel: 6 })), 0.5);
    assert.equal(lowStockSeverity(row({ onHand: 6, parLevel: 6 })), 0);
  });

  it('recency never decides what is shown: a healthy row touched last is not in the table', () => {
    // The old table took the 200 most recently updated rows and then
    // filtered; here the most recently updated rows are all healthy.
    const manyHealthy = Array.from({ length: 300 }, (_, i) => row({ name: `healthy-${i}`, onHand: 50, parLevel: 6 }));
    const oldLow = row({ name: 'old-low', onHand: 1, parLevel: 6 });
    const ranked = rankStockAttentionRows([...manyHealthy, oldLow]);
    assert.deepEqual(ranked.map((r) => r.name), ['old-low']);
  });

  it('labels the badge from the same thresholds', () => {
    assert.deepEqual(lowStockStatus(row({ onHand: 0, parLevel: 6 })), { stockStatus: 'OUT_OF_STOCK', suggestedAction: 'Out of stock' });
    assert.deepEqual(lowStockStatus(row({ onHand: 2, reorderPoint: 3, parLevel: 6 })), { stockStatus: 'LOW_STOCK', suggestedAction: 'Order soon' });
    assert.deepEqual(lowStockStatus(row({ onHand: 5, reorderPoint: 3, parLevel: 6 })), { stockStatus: 'BELOW_PAR', suggestedAction: 'Below par' });
  });
});
