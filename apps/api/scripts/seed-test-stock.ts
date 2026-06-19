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

  const counts = await prisma.stockItem.groupBy({ by: ['status'], _count: true });
  const recipeCount = await prisma.recipe.count();
  console.log('seeded test stock:', JSON.stringify(counts), 'recipes:', recipeCount);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
