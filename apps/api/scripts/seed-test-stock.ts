// Inserts representative stock items for the parity test (idempotent).
import { prisma } from '@alma/db';

async function main() {
  await prisma.stockItem.deleteMany({ where: { sku: { startsWith: 'TEST-' } } });
  const cat = await prisma.stockCategory.upsert({
    where: { name: 'Produce (test)' },
    update: {},
    create: { name: 'Produce (test)' }
  });
  await prisma.stockItem.createMany({
    data: [
      { sku: 'TEST-TOM', name: 'Tomatoes', unit: 'kg', onHand: 2, parLevel: 10, reorderPoint: 5, status: 'ACTIVE', categoryId: cat.id },
      { sku: 'TEST-OIL', name: 'Olive Oil', unit: 'L', onHand: 0, parLevel: 4, reorderPoint: 2, status: 'ACTIVE', categoryId: cat.id },
      { sku: 'TEST-SLT', name: 'Salt', unit: 'kg', onHand: 8, parLevel: 3, reorderPoint: 1, status: 'ACTIVE' },
      { sku: 'TEST-OLD', name: 'Discontinued', unit: 'ea', onHand: 0, parLevel: 5, reorderPoint: 2, status: 'ARCHIVED', categoryId: cat.id }
    ]
  });
  // recipes for the recipe-cost reroute test
  await prisma.recipe.deleteMany({ where: { legacyId: { startsWith: 'TEST-R' } } });
  await prisma.recipe.createMany({
    data: [
      { legacyId: 'TEST-R1', title: 'Marinara (test)', estimatedCost: 3.5, yieldQuantity: 4, portionSize: 1 },
      { legacyId: 'TEST-R2', title: 'Dressing (test)', estimatedCost: 0, yieldQuantity: null, portionSize: null }
    ]
  });

  // wastage records for the date-ranged reporting reroute (#8).
  // Includes a STAFF_MEAL reason (report must NOT exclude it) and one out-of-range row.
  const tom = await prisma.stockItem.findFirst({ where: { sku: 'TEST-TOM' } });
  if (tom) {
    await prisma.stockWastageRecord.deleteMany({ where: { note: 'TEST-WASTE' } });
    await prisma.stockWastageRecord.createMany({
      data: [
        { stockItemId: tom.id, venue: 'Main', quantity: 1, unit: 'kg', reason: 'SPOILAGE', note: 'TEST-WASTE', wastedAt: new Date('2026-06-10T00:00:00Z'), costImpactCents: 500 },
        { stockItemId: tom.id, venue: 'Main', quantity: 2, unit: 'kg', reason: 'STAFF_MEAL', note: 'TEST-WASTE', wastedAt: new Date('2026-06-11T00:00:00Z'), costImpactCents: 300 },
        { stockItemId: tom.id, venue: 'Annex', quantity: 1, unit: 'kg', reason: 'SPOILAGE', note: 'TEST-WASTE', wastedAt: new Date('2026-05-01T00:00:00Z'), costImpactCents: 999 }
      ]
    });
  }

  const counts = await prisma.stockItem.groupBy({ by: ['status'], _count: true });
  const recipeCount = await prisma.recipe.count();
  const wasteCount = await prisma.stockWastageRecord.count({ where: { note: 'TEST-WASTE' } });
  console.log('seeded test stock:', JSON.stringify(counts), 'recipes:', recipeCount, 'wastage:', wasteCount);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
