/**
 * LIVE data-parity test against a real (embedded) Postgres.
 *
 * Compares, on the SAME seeded database:
 *   A) the manager dashboard's original Prisma read (flag-OFF), and
 *   B) stock-api's itemsService.list(...) run through the SAME normalization
 *      stockReads.activeItems() applies (the flag-ON data path, minus the HTTP
 *      hop already proven by verify-stock-reads.ts).
 *
 * If A and B match on the fields the dashboard uses — and the low-stock result
 * matches — the reroute is value-correct on real data.
 *
 * Run with DATABASE_URL pointing at the test DB:
 *   node --import tsx apps/api/scripts/verify-dashboard-stock-parity.ts
 */
import assert from 'node:assert';
import { prisma } from '@alma/db';
// stock-api's real read services (what GET /api/items, /summary, /recipes call):
import { itemsService } from '../../stock-api/src/services/items.service.js';
import { recipesService } from '../../stock-api/src/services/recipes.service.js';

const isLow = (i: any) => {
  const threshold = i.reorderPoint ?? i.parLevel;
  return threshold > 0 && i.onHand <= threshold;
};
const norm = (i: any) => ({
  id: String(i.id),
  name: String(i.name ?? ''),
  unit: String(i.unit ?? ''),
  onHand: Number(i.onHand ?? 0),
  parLevel: Number(i.parLevel ?? 0),
  reorderPoint: Number(i.reorderPoint ?? 0),
  categoryName: i.category ? String(i.category.name ?? '') : null
});

async function main() {
  // A) flag-OFF: the exact dashboard query
  const prismaRows = await prisma.stockItem.findMany({
    where: { status: 'ACTIVE' },
    include: { category: { select: { name: true } } },
    orderBy: [{ name: 'asc' }]
  });
  const a = prismaRows.map(norm).sort((x, y) => x.id.localeCompare(y.id));

  // B) flag-ON data path: stock-api list + the adapter's normalization + ACTIVE filter
  const payload: any = await itemsService.list(null, null);
  const b = (payload.items ?? [])
    .filter((i: any) => i?.status === undefined || i?.status === 'ACTIVE')
    .map(norm)
    .sort((x: any, y: any) => x.id.localeCompare(y.id));

  console.log(`A (dashboard prisma): ${a.length} active items`);
  console.log(`B (stock-api list):   ${b.length} active items`);

  assert.deepEqual(b, a, 'normalized item sets differ between dashboard query and stock-api list');

  const lowA = a.filter(isLow).map((i) => i.id).sort();
  const lowB = b.filter(isLow).map((i) => i.id).sort();
  assert.deepEqual(lowB, lowA, `low-stock set differs: A=${lowA} B=${lowB}`);
  console.log(`low-stock count: ${lowA.length} (identical in both paths)`);

  // ---- reports #2: ACTIVE catalogue count ----
  const countA = await prisma.stockItem.count({ where: { status: 'ACTIVE' } });
  const summary: any = await itemsService.summary(null, null);
  const countB = Number(summary.activeItems ?? 0);
  assert.equal(countB, countA, `active count differs: A=${countA} B=${countB}`);
  console.log(`#2 active catalogue count: ${countA} (api=${countB}) ✅`);

  // ---- reports #10: recipe cost inputs ----
  const recNorm = (r: any) => ({
    id: String(r.id),
    estimatedCost: Number(r.estimatedCost ?? 0),
    yieldQuantity: r.yieldQuantity == null ? null : Number(r.yieldQuantity),
    portionSize: r.portionSize == null ? null : Number(r.portionSize)
  });
  const recA = (await prisma.recipe.findMany({ select: { id: true, estimatedCost: true, yieldQuantity: true, portionSize: true } }))
    .map(recNorm).sort((x, y) => x.id.localeCompare(y.id));
  const recPayload: any = await recipesService.list({ withSalesLookbackDays: null });
  const recB = (recPayload.recipes ?? []).map(recNorm).sort((x: any, y: any) => x.id.localeCompare(y.id));
  assert.deepEqual(recB, recA, 'recipe cost rows differ between prisma and stock-api');
  console.log(`#10 recipe cost rows: ${recA.length} (identical in both paths) ✅`);

  console.log('LIVE PARITY OK ✅ — dashboard items + reports #2 + reports #10 match flag-OFF on real data');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('LIVE PARITY FAILED ❌');
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
