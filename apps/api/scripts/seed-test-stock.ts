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

  // stocktakes for the per-venue status reroute (#11-13):
  // Main = fresh LOCKED with line values (→ good); Annex = SUBMITTED only (→ partial).
  await prisma.stocktake.deleteMany({ where: { legacyId: { startsWith: 'TEST-ST' } } });
  await prisma.stocktake.create({
    data: {
      legacyId: 'TEST-ST1', name: 'Main Lock', venue: 'Main', status: 'LOCKED',
      countedAt: new Date(), lockedAt: new Date(),
      lines: { create: [ { label: 'L1', position: 0, stockValueCents: 1000 }, { label: 'L2', position: 1, stockValueCents: 2000 } ] }
    }
  });
  await prisma.stocktake.create({
    data: { legacyId: 'TEST-ST2', name: 'Annex Sub', venue: 'Annex', status: 'SUBMITTED', countedAt: new Date() }
  });

  // venue stock rows (#3 low/out-of-stock) + a SUBMITTED Main stocktake with
  // item-linked lines (#5 review cards, #6 variance, #1 venue on-hand lookup).
  const items = await prisma.stockItem.findMany({ where: { sku: { startsWith: 'TEST-' } } });
  const bySku: Record<string, string> = Object.fromEntries(items.map((i) => [i.sku!, i.id]));
  await prisma.venueStockItem.deleteMany({ where: { stockItemId: { in: items.map((i) => i.id) } } });
  await prisma.venueStockItem.createMany({
    data: [
      { venue: 'Main', stockItemId: bySku['TEST-TOM'], onHand: 2, parLevel: 10, reorderPoint: 5, active: true },
      { venue: 'Main', stockItemId: bySku['TEST-OIL'], onHand: 0, parLevel: 4, reorderPoint: 2, active: true },
      { venue: 'Main', stockItemId: bySku['TEST-SLT'], onHand: 8, parLevel: 3, reorderPoint: 1, active: true }
    ]
  });
  await prisma.stocktake.create({
    data: {
      legacyId: 'TEST-ST3', name: 'Main Review', venue: 'Main', status: 'SUBMITTED',
      countedAt: new Date(), submittedAt: new Date(),
      lines: {
        create: [
          { label: 'Tom', position: 0, itemId: bySku['TEST-TOM'], countedQty: 5, stockValueCents: 500 },
          { label: 'Oil', position: 1, itemId: bySku['TEST-OIL'], countedQty: 1, stockValueCents: 200 }
        ]
      }
    }
  });

  // supplier invoices for prime-cost COGS (#7): one in-range (with a no-item line
  // that must be excluded) + one out-of-range (must be excluded).
  await prisma.supplierInvoice.deleteMany({ where: { invoiceKey: { startsWith: 'TEST-INV' } } });
  await prisma.supplierInvoice.create({
    data: {
      invoiceKey: 'TEST-INV1', supplierName: 'Test Supplier', venue: 'Main', invoiceDate: new Date('2026-06-15T00:00:00Z'), status: 'APPROVED',
      lines: { create: [
        { lineNumber: 1, lineKey: 'TEST-INV1-1', description: 'Tomatoes', itemId: bySku['TEST-TOM'], lineAmountCents: 1500 },
        { lineNumber: 2, lineKey: 'TEST-INV1-2', description: 'Oil', itemId: bySku['TEST-OIL'], lineAmountCents: 2500 },
        { lineNumber: 3, lineKey: 'TEST-INV1-3', description: 'NoItem', lineAmountCents: 9999 }
      ] }
    }
  });
  await prisma.supplierInvoice.create({
    data: {
      invoiceKey: 'TEST-INV2', supplierName: 'Test Supplier', venue: 'Main', invoiceDate: new Date('2026-05-01T00:00:00Z'), status: 'APPROVED',
      lines: { create: [ { lineNumber: 1, lineKey: 'TEST-INV2-1', description: 'Old', itemId: bySku['TEST-TOM'], lineAmountCents: 7777 } ] }
    }
  });

  const counts = await prisma.stockItem.groupBy({ by: ['status'], _count: true });
  const recipeCount = await prisma.recipe.count();
  const wasteCount = await prisma.stockWastageRecord.count({ where: { note: 'TEST-WASTE' } });
  const stCount = await prisma.stocktake.count({ where: { legacyId: { startsWith: 'TEST-ST' } } });
  console.log('seeded test stock:', JSON.stringify(counts), 'recipes:', recipeCount, 'wastage:', wasteCount, 'stocktakes:', stCount);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
