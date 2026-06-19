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
import { stockOperationsService } from '../../stock-api/src/services/stock-operations.service.js';
import { stocktakesService } from '../../stock-api/src/services/stocktakes.service.js';
// the suite report (flag is OFF here, so this runs its ORIGINAL prisma path):
import { reportsService } from '../src/services/reports.service.js';

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

  // ---- reports #8: wastage in a date range (prime-cost) ----
  const from = '2026-06-01T00:00:00.000Z';
  const to = '2026-07-01T00:00:00.000Z';
  const wNorm = (w: any) => ({ venue: String(w.venue), costImpactCents: w.costImpactCents == null ? null : Number(w.costImpactCents) });
  const wSort = (x: any, y: any) => x.venue.localeCompare(y.venue) || (x.costImpactCents ?? 0) - (y.costImpactCents ?? 0);
  const wA = (await prisma.stockWastageRecord.findMany({
    where: { wastedAt: { gte: new Date(from), lt: new Date(to) } },
    select: { venue: true, costImpactCents: true }
  })).map(wNorm).sort(wSort);
  const wB = (await stockOperationsService.listWastageForReport({ from, to })).map(wNorm).sort(wSort);
  assert.deepEqual(wB, wA, 'wastage rows differ between prisma and stock-api report feed');
  const sum = (rows: any[]) => rows.reduce((s, w) => s + Math.max(0, w.costImpactCents ?? 0), 0);
  assert.equal(sum(wB), sum(wA), 'wastage cost sum differs');
  // sanity: the out-of-range May row must be excluded; the STAFF_MEAL row must be INCLUDED
  assert.equal(wA.length, 2, `expected 2 in-range wastage rows (May excluded), got ${wA.length}`);
  console.log(`#8 wastage rows in range: ${wA.length}, cost sum ${sum(wA)}c (identical; STAFF_MEAL kept, May excluded) ✅`);

  // ---- reports #11-13: per-venue stocktake status (report's own output vs ported stock-api) ----
  const stripGen = (o: any) => ({ staleDays: o.staleDays, venues: [...o.venues].sort((x, y) => x.venue.localeCompare(y.venue)) });
  const reportStatus = await reportsService.stocktakeStatus({ isAdmin: true } as any); // flag OFF → original prisma path
  const apiStatus = await stocktakesService.venueStatus({ venue: null });
  assert.deepEqual(stripGen(apiStatus), stripGen(reportStatus), 'stocktake venue-status differs (report vs stock-api)');
  const main = apiStatus.venues.find((v: any) => v.venue === 'Main');
  const annex = apiStatus.venues.find((v: any) => v.venue === 'Annex');
  assert.equal(main?.latestLocked?.stockValueCents, 3000, 'Main locked value should be 3000');
  assert.equal(main?.quality, 'good', 'Main should be good (fresh lock)');
  assert.equal(annex?.quality, 'partial', 'Annex should be partial (submitted, no lock)');
  console.log(`#11-13 stocktake status: ${apiStatus.venues.length} venues, Main locked=3000c/good, Annex=partial (identical) ✅`);

  console.log('LIVE PARITY OK ✅ — dashboard items + reports #2/#8/#10/#11-13 match flag-OFF on real data');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('LIVE PARITY FAILED ❌');
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
