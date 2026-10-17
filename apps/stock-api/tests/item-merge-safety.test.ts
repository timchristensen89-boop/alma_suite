import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '@alma/db';
import { itemsService } from '../src/services/items.service.js';
import { countUnitFactor } from '../src/services/item-merge.js';

/**
 * Regression suite for the 17 Oct 2026 incident: merging duplicates in the app
 * added holdings and same-sheet count lines together. A merge must never raise
 * stock on its own, never rewrite a count, refuse when the records disagree,
 * stay within each venue, and change nothing when repeated.
 */
const NO_DB = { skip: !process.env.DATABASE_URL };
const CONFIRM = 'MERGE ITEMS' as const;
const tagOf = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

type ItemSpec = { name: string; unit: string; countUnit?: string | null; measurePerCountUnit?: number | null; measureUnit?: string | null; avgCostCents?: number | null; holdings: Record<string, number | null> };

async function makeItems(tag: string, specs: ItemSpec[]) {
  const items = [];
  for (const spec of specs) {
    items.push(await prisma.stockItem.create({
      data: {
        name: `${spec.name} ${tag}`, unit: spec.unit, countUnit: spec.countUnit ?? spec.unit, conversionFactor: 1,
        measurePerCountUnit: spec.measurePerCountUnit ?? null, measureUnit: spec.measureUnit ?? null,
        avgCostCents: 'avgCostCents' in spec ? spec.avgCostCents ?? null : 1000, onHand: Object.values(spec.holdings).reduce<number>((s, v) => s + (v ?? 0), 0), parLevel: 0, status: 'ACTIVE',
        venueStock: { create: Object.entries(spec.holdings).map(([venue, onHand]) => ({ venue, onHand, active: true })) }
      }
    }));
  }
  const ids = items.map((i) => i.id);
  const sheetIds: string[] = [];
  return {
    items, ids, sheetIds,
    async cleanup() {
      await prisma.inventoryMovement.deleteMany({ where: { OR: [{ itemId: { in: ids } }, { sourceStocktakeId: { in: sheetIds } }] } });
      await prisma.stocktake.deleteMany({ where: { id: { in: sheetIds } } });
      await prisma.venueStockItem.deleteMany({ where: { stockItemId: { in: ids } } });
      await prisma.stockItem.deleteMany({ where: { id: { in: ids } } });
    }
  };
}

async function holdingsOf(ids: string[]) {
  const rows = await prisma.venueStockItem.findMany({ where: { stockItemId: { in: ids } }, orderBy: [{ venue: 'asc' }, { stockItemId: 'asc' }] });
  return rows.map((r) => [r.stockItemId, r.venue, r.onHand]);
}

async function historyOf(ids: string[], sheetIds: string[]) {
  const lines = await prisma.stocktakeLine.findMany({ where: { OR: [{ itemId: { in: ids } }, { stocktakeId: { in: sheetIds } }] }, orderBy: { id: 'asc' } });
  const moves = await prisma.inventoryMovement.findMany({ where: { OR: [{ itemId: { in: ids } }, { sourceStocktakeId: { in: sheetIds } }] }, orderBy: { id: 'asc' } });
  return {
    lines: lines.map((l) => [l.id, l.stocktakeId, l.countedQty, l.unit, l.stockValueCents, l.notes, l.label]),
    moves: moves.filter((m) => m.movementType !== 'STOCKTAKE_CORRECTION').map((m) => [m.id, m.quantityBefore, m.quantityAfter, m.quantityDelta, m.sourceStocktakeLineId])
  };
}

test('unit factors: same unit is 1, a 12.5 kg bag is 12.5 kg-units, mL↔L converts, unrelated units are unknown', () => {
  assert.equal(countUnitFactor({ unit: 'bottle', countUnit: 'bottle', measurePerCountUnit: 700, measureUnit: 'ml' }, { unit: 'bottle', countUnit: 'bottle', measurePerCountUnit: 700, measureUnit: 'ml' }), 1);
  assert.equal(countUnitFactor({ unit: 'each', countUnit: 'each', measurePerCountUnit: 12500, measureUnit: 'g' }, { unit: 'each', countUnit: 'each', measurePerCountUnit: 1000, measureUnit: 'g' }), 12.5);
  assert.equal(countUnitFactor({ unit: 'each', countUnit: 'each', measurePerCountUnit: 5000, measureUnit: 'ml' }, { unit: 'L', countUnit: 'L', measurePerCountUnit: null, measureUnit: null }), 5);
  assert.equal(countUnitFactor({ unit: 'kg', countUnit: 'kg', measurePerCountUnit: null, measureUnit: null }, { unit: 'each', countUnit: 'each', measurePerCountUnit: 2000, measureUnit: 'g' }), 0.5);
  assert.equal(countUnitFactor({ unit: 'each', countUnit: 'each', measurePerCountUnit: 100, measureUnit: 'g' }, { unit: 'L', countUnit: 'L', measurePerCountUnit: null, measureUnit: null }), null, 'grams cannot become litres');
  assert.equal(countUnitFactor({ unit: 'box', countUnit: 'box', measurePerCountUnit: null, measureUnit: null }, { unit: 'each', countUnit: 'each', measurePerCountUnit: 400, measureUnit: 'g' }), null);
});

test('both records hold stock: refused without a decision, and nothing changes', NO_DB, async () => {
  const f = await makeItems(tagOf('conflict'), [
    { name: 'Giffard Rose 1L', unit: 'bottle', holdings: { 'St Alma': 4.5, 'Alma Avalon': 0.73 } },
    { name: 'Giffard Rose Syrup', unit: 'bottle', holdings: { 'St Alma': 3.1, 'Alma Avalon': 1.1 } }
  ]);
  try {
    const before = await holdingsOf(f.ids);
    const preview = await itemsService.previewMerge({ parentId: f.ids[0], duplicateIds: [f.ids[1]] });
    assert.deepEqual(preview.venues.map((v) => [v.venue, v.outcome, v.needsDecision]), [['Alma Avalon', 'decide', true], ['St Alma', 'decide', true]]);
    await assert.rejects(itemsService.mergeItems({ parentId: f.ids[0], duplicateIds: [f.ids[1]], confirmationText: CONFIRM }), (e: { statusCode?: number }) => e.statusCode === 409);
    // Deciding one venue is not enough.
    await assert.rejects(itemsService.mergeItems({ parentId: f.ids[0], duplicateIds: [f.ids[1]], confirmationText: CONFIRM, holdings: [{ venue: 'St Alma', keep: 'keep' }] }), /Alma Avalon/);
    assert.deepEqual(await holdingsOf(f.ids), before, 'a refused merge writes nothing');
    const items = await prisma.stockItem.findMany({ where: { id: { in: f.ids } } });
    assert.ok(items.every((i) => i.status === 'ACTIVE'));
  } finally {
    await f.cleanup();
  }
});

test('decisions are applied per venue, exactly; nothing is ever added together', NO_DB, async () => {
  const f = await makeItems(tagOf('decide'), [
    { name: 'Supasawa A', unit: 'bottle', holdings: { 'St Alma': 3.3, 'Alma Avalon': 1.4 } },
    { name: 'Supasawa B', unit: 'bottle', holdings: { 'St Alma': 2, 'Alma Avalon': 1 } }
  ]);
  try {
    const preview = await itemsService.previewMerge({ parentId: f.ids[0], duplicateIds: [f.ids[1]] });
    const result = await itemsService.mergeItems({
      parentId: f.ids[0], duplicateIds: [f.ids[1]], confirmationText: CONFIRM, planToken: preview.planToken,
      holdings: [{ venue: 'St Alma', keep: 'duplicate', itemId: f.ids[1] }, { venue: 'Alma Avalon', keep: 'counted', countedQty: 2.4 }]
    });
    assert.deepEqual(result.holdings, [{ venue: 'Alma Avalon', before: 1.4, after: 2.4 }, { venue: 'St Alma', before: 3.3, after: 2 }]);
    assert.deepEqual(await holdingsOf(f.ids), [[f.ids[0], 'Alma Avalon', 2.4], [f.ids[0], 'St Alma', 2]]);
    const kept = await prisma.stockItem.findUniqueOrThrow({ where: { id: f.ids[0] } });
    assert.equal(kept.onHand, 4.4);
    // Every change is on the ledger, for both records.
    const corrections = await prisma.inventoryMovement.findMany({ where: { itemId: { in: f.ids }, movementType: 'STOCKTAKE_CORRECTION' } });
    assert.equal(corrections.length, 4, 'kept item at two venues + the duplicate\'s two dropped holdings');
    assert.ok(corrections.every((m) => /nothing added together|merged into/.test(m.notes ?? '')));
  } finally {
    await f.cleanup();
  }
});

test('only one record holds stock: carried across, converted to the kept unit, within its own venue', NO_DB, async () => {
  const f = await makeItems(tagOf('carry'), [
    { name: 'Flour Plain', unit: 'each', measurePerCountUnit: 1000, measureUnit: 'g', avgCostCents: 112, holdings: { 'Alma Avalon': 0, 'St Alma': 3 } },
    { name: 'FLOUR PLAIN 12.5KG', unit: 'each', measurePerCountUnit: 12500, measureUnit: 'g', avgCostCents: 1400, holdings: { 'Alma Avalon': 1 } },
    { name: 'Lime Juice 5L', unit: 'each', measurePerCountUnit: 5000, measureUnit: 'ml', holdings: {} }
  ]);
  try {
    const result = await itemsService.mergeItems({ parentId: f.ids[0], duplicateIds: [f.ids[1]], confirmationText: CONFIRM });
    assert.deepEqual(result.holdings, [{ venue: 'Alma Avalon', before: 0, after: 12.5 }, { venue: 'St Alma', before: 3, after: 3 }]);
    const kept = await prisma.stockItem.findUniqueOrThrow({ where: { id: f.ids[0] } });
    assert.equal(kept.measurePerCountUnit, 1000, 'the 12.5 kg measure is not copied onto the 1 kg record');
    assert.equal(kept.avgCostCents, 112);
  } finally {
    await f.cleanup();
  }
});

test('a unit that cannot be converted needs the counted quantity; unit-dependent fields are not copied across units', NO_DB, async () => {
  const f = await makeItems(tagOf('units'), [
    { name: 'Lime Juice (1 x 5L)', unit: 'L', countUnit: 'L', avgCostCents: null, holdings: { 'St Alma': 0 } },
    { name: 'Lime Juice box', unit: 'box', countUnit: 'box', measurePerCountUnit: null, avgCostCents: 7000, holdings: { 'St Alma': 2 } }
  ]);
  try {
    const preview = await itemsService.previewMerge({ parentId: f.ids[0], duplicateIds: [f.ids[1]] });
    assert.equal(preview.duplicates[0]!.factor, null);
    assert.equal(preview.venues[0]!.needsDecision, true);
    assert.match(preview.venues[0]!.reason ?? '', /cannot be converted/);
    await assert.rejects(itemsService.mergeItems({ parentId: f.ids[0], duplicateIds: [f.ids[1]], confirmationText: CONFIRM, holdings: [{ venue: 'St Alma', keep: 'duplicate', itemId: f.ids[1] }] }), /cannot be converted/);
    await itemsService.mergeItems({ parentId: f.ids[0], duplicateIds: [f.ids[1]], confirmationText: CONFIRM, holdings: [{ venue: 'St Alma', keep: 'counted', countedQty: 10 }] });
    const kept = await prisma.stockItem.findUniqueOrThrow({ where: { id: f.ids[0] } });
    assert.equal(kept.avgCostCents, null, 'a per-box cost is never copied onto a per-litre item');
    assert.deepEqual(await holdingsOf([f.ids[0]]), [[f.ids[0], 'St Alma', 10]]);
  } finally {
    await f.cleanup();
  }
});

test('history is repointed exactly: applied counts keep every line, quantity, value and note; movements keep their lines', NO_DB, async () => {
  const f = await makeItems(tagOf('history'), [
    { name: 'Onion Powder 500g', unit: 'each', holdings: { 'Alma Avalon': 0.5 } },
    { name: 'Onion Powder', unit: 'each', holdings: {} }
  ]);
  try {
    const sheet = await prisma.stocktake.create({
      data: {
        name: `1 Oct ${f.ids[0]}`, venue: 'Alma Avalon', countedAt: new Date('2026-10-01'), status: 'REVIEWED', appliedAt: new Date('2026-10-16'),
        lines: { create: [
          { position: 1, label: 'ONION POWDER 500GM', itemId: f.ids[0], countedQty: 0.5, unit: 'each', stockValueCents: 450 },
          { position: 2, label: 'Onion Powder', itemId: f.ids[1], countedQty: 1, unit: 'each', stockValueCents: 900, notes: 'top shelf' }
        ] }
      },
      include: { lines: true }
    });
    f.sheetIds.push(sheet.id);
    const dupLine = sheet.lines.find((l) => l.itemId === f.ids[1])!;
    await prisma.inventoryMovement.create({ data: { itemId: f.ids[1], movementType: 'STOCKTAKE_ADJUSTMENT', quantityBefore: 0, quantityAfter: 1, quantityDelta: 1, unit: 'each', sourceStocktakeId: sheet.id, sourceStocktakeLineId: dupLine.id } });
    const before = await historyOf(f.ids, f.sheetIds);
    await itemsService.mergeItems({ parentId: f.ids[0], duplicateIds: [f.ids[1]], confirmationText: CONFIRM });
    const after = await historyOf(f.ids, f.sheetIds);
    assert.deepEqual(after, before, 'every line and movement reads exactly as before');
    const lines = await prisma.stocktakeLine.findMany({ where: { stocktakeId: sheet.id } });
    assert.equal(lines.length, 2, 'no line deleted or folded');
    assert.ok(lines.every((l) => l.itemId === f.ids[0]), 'both lines now name the kept item');
  } finally {
    await f.cleanup();
  }
});

test('an open count listing both records blocks the merge', NO_DB, async () => {
  const f = await makeItems(tagOf('open'), [
    { name: 'Cauliflower', unit: 'each', holdings: { 'St Alma': 2 } },
    { name: 'Cauliflower Each', unit: 'each', holdings: {} }
  ]);
  try {
    const sheet = await prisma.stocktake.create({
      data: { name: `Open ${f.ids[0]}`, venue: 'St Alma', countedAt: new Date(), status: 'IN_PROGRESS', lines: { create: [
        { position: 1, label: 'a', itemId: f.ids[0], countedQty: 2, unit: 'each' },
        { position: 2, label: 'b', itemId: f.ids[1], countedQty: null, unit: 'each' }
      ] } }
    });
    f.sheetIds.push(sheet.id);
    const preview = await itemsService.previewMerge({ parentId: f.ids[0], duplicateIds: [f.ids[1]] });
    assert.equal(preview.blockers.length, 1);
    assert.match(preview.blockers[0]!, /open count/);
    await assert.rejects(itemsService.mergeItems({ parentId: f.ids[0], duplicateIds: [f.ids[1]], confirmationText: CONFIRM }), /open count/);
  } finally {
    await f.cleanup();
  }
});

test('a stale review is refused, and repeating a finished merge changes nothing', NO_DB, async () => {
  const f = await makeItems(tagOf('idem'), [
    { name: 'Sesame Seed White 1kg', unit: 'each', holdings: { 'St Alma': 0.31 } },
    { name: 'Sesame Seed White', unit: 'each', holdings: { 'Alma Avalon': 0.97 } }
  ]);
  try {
    const preview = await itemsService.previewMerge({ parentId: f.ids[0], duplicateIds: [f.ids[1]] });
    await prisma.venueStockItem.updateMany({ where: { stockItemId: f.ids[1] }, data: { onHand: 2 } });
    await assert.rejects(itemsService.mergeItems({ parentId: f.ids[0], duplicateIds: [f.ids[1]], confirmationText: CONFIRM, planToken: preview.planToken }), /changed since you reviewed/);
    await itemsService.mergeItems({ parentId: f.ids[0], duplicateIds: [f.ids[1]], confirmationText: CONFIRM });
    const once = { holdings: await holdingsOf(f.ids), items: await prisma.stockItem.findMany({ where: { id: { in: f.ids } }, orderBy: { id: 'asc' } }), moves: await prisma.inventoryMovement.count({ where: { itemId: { in: f.ids } } }) };
    const again = await itemsService.mergeItems({ parentId: f.ids[0], duplicateIds: [f.ids[1]], confirmationText: CONFIRM });
    assert.equal(again.alreadyMerged, true);
    assert.equal(again.mergedCount, 0);
    assert.deepEqual({ holdings: await holdingsOf(f.ids), items: await prisma.stockItem.findMany({ where: { id: { in: f.ids } }, orderBy: { id: 'asc' } }), moves: await prisma.inventoryMovement.count({ where: { itemId: { in: f.ids } } }) }, once);
    // Two clicks at once: one merges, the other finds nothing left to do.
    const g = await makeItems(tagOf('race'), [
      { name: 'Rice Basmati 1kg', unit: 'each', holdings: { 'Alma Avalon': 4 } },
      { name: 'Rice Basmati', unit: 'each', holdings: { 'St Alma': 1 } }
    ]);
    try {
      const both = await Promise.allSettled([0, 1].map(() => itemsService.mergeItems({ parentId: g.ids[0], duplicateIds: [g.ids[1]], confirmationText: CONFIRM })));
      assert.ok(both.every((r) => r.status === 'fulfilled'));
      assert.equal(both.filter((r) => r.status === 'fulfilled' && r.value.alreadyMerged).length, 1);
      assert.deepEqual(await holdingsOf(g.ids), [[g.ids[0], 'Alma Avalon', 4], [g.ids[0], 'St Alma', 1]]);
    } finally {
      await g.cleanup();
    }
  } finally {
    await f.cleanup();
  }
});

test('property: without a counted quantity, no merge ever raises a venue above its largest record', NO_DB, async () => {
  // Deterministic pseudo-random holdings across three records and two venues.
  let seed = 17;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let round = 0; round < 12; round++) {
    const value = () => (rand() < 0.4 ? 0 : Math.round(rand() * 1000) / 100);
    const specs: ItemSpec[] = [0, 1, 2].map((i) => ({ name: `Prop ${round}-${i}`, unit: 'bottle', holdings: { 'St Alma': value(), 'Alma Avalon': value() } }));
    const f = await makeItems(tagOf(`prop${round}`), specs);
    try {
      const preview = await itemsService.previewMerge({ parentId: f.ids[0], duplicateIds: f.ids.slice(1) });
      // Pick a holder's quantity wherever a decision is needed — never "counted".
      const holdings = preview.venues.filter((v) => v.needsDecision).map((v) => {
        const pick = v.members.filter((m) => (m.onHand ?? 0) > 0)[Math.floor(rand() * 2) % 2]!;
        return pick.isKept ? { venue: v.venue, keep: 'keep' as const } : { venue: v.venue, keep: 'duplicate' as const, itemId: pick.itemId };
      });
      const before = await holdingsOf(f.ids);
      await itemsService.mergeItems({ parentId: f.ids[0], duplicateIds: f.ids.slice(1), confirmationText: CONFIRM, holdings });
      for (const venue of ['St Alma', 'Alma Avalon']) {
        const largest = Math.max(0, ...before.filter((r) => r[1] === venue).map((r) => Number(r[2] ?? 0)));
        const total = before.filter((r) => r[1] === venue).reduce((s, r) => s + Number(r[2] ?? 0), 0);
        const after = (await prisma.venueStockItem.findFirst({ where: { stockItemId: f.ids[0], venue } }))?.onHand ?? 0;
        assert.ok(after <= largest + 1e-9, `round ${round} ${venue}: ${after} > largest ${largest}`);
        if (total > largest + 1e-9) assert.ok(after < total, 'never the sum of two holdings');
      }
    } finally {
      await f.cleanup();
    }
  }
});
