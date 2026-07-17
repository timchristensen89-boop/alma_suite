/**
 * Parity harness for the stock-forward reroute.
 *
 * Stands up a fake stock-api returning a representative GET /api/items payload
 * (in the real `toItemPayload` shape, incl. extra fields like totalOnHand/sku),
 * then runs the REAL stockReads.activeItems() against it and checks that the
 * normalized output is byte-compatible with what the dashboard's Prisma read
 * would have produced — and that the downstream lowStock computation matches.
 *
 * What this proves: the client + adapter code (HTTP call, token header, `.items`
 * extraction, ACTIVE filter, field mapping incl. picking onHand NOT totalOnHand).
 * What it can't prove here: that stock-api's live DB returns the same rows as the
 * suite's Prisma query — that's a data question needing the real Postgres.
 *
 * Run: node --import tsx apps/api/scripts/verify-stock-reads.ts
 */
import http from 'node:http';
import assert from 'node:assert';

// --- canned data: 3 ACTIVE (one low, one out, one ok) + 1 ARCHIVED ---
const rows = [
  { id: 'a', name: 'Tomatoes', unit: 'kg', onHand: 2, totalOnHand: 99, parLevel: 10, reorderPoint: 5, status: 'ACTIVE', sku: 'TOM', category: { id: 'c1', name: 'Produce' } },
  { id: 'b', name: 'Olive Oil', unit: 'L', onHand: 0, totalOnHand: 0, parLevel: 4, reorderPoint: 2, status: 'ACTIVE', sku: 'OIL', category: { id: 'c2', name: 'Pantry' } },
  { id: 'c', name: 'Salt', unit: 'kg', onHand: 8, totalOnHand: 8, parLevel: 3, reorderPoint: 1, status: 'ACTIVE', sku: 'SLT', category: null },
  { id: 'z', name: 'Discontinued', unit: 'ea', onHand: 0, totalOnHand: 0, parLevel: 5, reorderPoint: 2, status: 'ARCHIVED', sku: 'OLD', category: { id: 'c2', name: 'Pantry' } }
];

// dashboard's lowStock predicate (copied from staff.service getManagerDashboard)
const isLow = (i: any) => {
  const threshold = i.reorderPoint ?? i.parLevel;
  return threshold > 0 && i.onHand <= threshold;
};

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/items')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ items: rows, categories: [], venueStockItems: [], venues: [], scope: {} }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  process.env.STOCK_API_URL = `http://127.0.0.1:${port}`;
  process.env.STOCK_API_TOKEN = 'test-token';

  // import AFTER env is set
  const { stockReads } = await import('../src/clients/stock-reads.js');

  const got = await stockReads.activeItems();

  // 1) ARCHIVED filtered out
  assert.equal(got.length, 3, `expected 3 ACTIVE items, got ${got.length}`);
  assert.ok(!got.some((i) => i.id === 'z'), 'ARCHIVED item leaked through');

  // 2) field mapping correct — and onHand is the per-item value, NOT totalOnHand
  const tom = got.find((i) => i.id === 'a')!;
  assert.equal(tom.onHand, 2, `onHand should be 2 (item field), got ${tom.onHand} (totalOnHand bug?)`);
  assert.equal(tom.unit, 'kg');
  assert.equal(tom.parLevel, 10);
  assert.equal(tom.reorderPoint, 5);
  assert.equal(tom.category?.name, 'Produce');
  assert.equal(got.find((i) => i.id === 'c')!.category, null, 'null category should stay null');

  // 3) downstream lowStock parity: API-path result vs the same ACTIVE rows
  //    as the Prisma path would have returned them.
  const prismaEquivalent = rows.filter((r) => r.status === 'ACTIVE');
  const lowFromApi = got.filter(isLow).map((i) => i.id).sort();
  const lowFromPrisma = prismaEquivalent.filter(isLow).map((i) => i.id).sort();
  assert.deepEqual(lowFromApi, lowFromPrisma, `lowStock mismatch: api=${lowFromApi} prisma=${lowFromPrisma}`);
  assert.deepEqual(lowFromApi, ['a', 'b'], 'expected Tomatoes(low) + Olive Oil(out) to be low-stock');

  server.close();
  console.log('PARITY OK ✅');
  console.log(`  active items: ${got.length} (ARCHIVED filtered)`);
  console.log(`  onHand picks item field (2) not totalOnHand (99): ${tom.onHand === 2}`);
  console.log(`  lowStock api==prisma: [${lowFromApi.join(', ')}]`);
}

main().catch((e) => {
  console.error('PARITY FAILED ❌');
  console.error(e);
  process.exit(1);
});
