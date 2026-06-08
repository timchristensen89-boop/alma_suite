import { prisma } from '@alma/db';

// Merge duplicate stock items into one parent (usable at either venue via the
// existing per-venue stock). Groups items by a normalised "core" name, picks the
// most-detailed item as the parent, reassigns EVERY reference (recipes, stocktakes,
// invoices, movements, transfers, wastage, deliveries, reorders, Square mappings,
// per-venue stock) to it, then deletes the duplicates.
//
// SAFETY:
//  - DRY RUN by default — set MERGE_CONFIRM=YES to write.
//  - Groups whose members have DIFFERENT explicit sizes (e.g. 1kg vs 12.5kg) are
//    FLAGGED and skipped — those are different products, not duplicates.
//  - Wine/Spirits/Liqueur items are only merged on an EXACT name match (vintages
//    and bottlings are distinct), never fuzzily.
//  - Per-venue stock conflicts (both parent and dup hold the same venue) are merged
//    by summing on-hand.

const CONFIRM = process.env.MERGE_CONFIRM === 'YES';

const SIZE_RE = /\b\d+(\.\d+)?\s?(kg|g|gm|gram|grams?|ml|l|ltr|lt|litres?|liters?|inch|cm|mm)\b/gi;
const PRECISE_CATS = /wine|spirit|liqueur|aperitif/i;

function coreName(name: string): string {
  let n = name.toLowerCase();
  n = n.replace(/\(case of \d+\)/gi, ' ');
  n = n.replace(/\bea\s*\(\d+\)/gi, ' ');
  n = n.replace(/\([^)]*\)/g, ' ');        // brand / pack parens
  n = n.replace(SIZE_RE, ' ');             // size tokens
  n = n.replace(/\b(ea|each|pk|pack|ctn|carton|case|box|tray|bag|tin|jar|bottle|btl)\b/gi, ' ');
  n = n.replace(/[^a-z0-9 ]/g, ' ');
  return n.replace(/\s+/g, ' ').trim();
}
function sizeTokens(name: string): string[] {
  return (name.toLowerCase().match(SIZE_RE) || []).map((s) => s.replace(/\s+/g, ''));
}

async function main() {
  const items = await prisma.stockItem.findMany({
    select: {
      id: true, name: true, sku: true, status: true, latestCostCents: true,
      categoryId: true, category: { select: { name: true } },
      _count: {
        select: {
          recipeLines: true, stocktakeLines: true, invoiceLines: true,
          movements: true, transfers: true, wastageRecords: true,
          deliveryCheckItems: true, reorderNotices: true, squareMenuMappings: true, venueStock: true
        }
      }
    }
  });

  const refScore = (it: typeof items[number]) =>
    it._count.recipeLines + it._count.stocktakeLines + it._count.invoiceLines +
    it._count.movements + it._count.transfers + it._count.venueStock;

  // Group: precise categories key on the EXACT lowercased name; everything else
  // on the fuzzy core name.
  const groups = new Map<string, typeof items>();
  for (const it of items) {
    const precise = PRECISE_CATS.test(it.category?.name ?? '');
    const key = precise ? `exact:${it.name.trim().toLowerCase()}` : `core:${coreName(it.name)}`;
    if (!coreName(it.name) && !precise) continue;
    const list = groups.get(key) ?? []; list.push(it); groups.set(key, list);
  }

  const merges: Array<{ parent: typeof items[number]; dups: typeof items[number][] }> = [];
  const sizeConflicts: typeof items[] = [];

  for (const [, list] of groups) {
    if (list.length < 2) continue;
    const sizes = new Set(list.flatMap((it) => sizeTokens(it.name)));
    if (sizes.size > 1) { sizeConflicts.push(list); continue; }   // different sizes → not dupes
    // Parent = most references, then has sku, then has cost, then longest name.
    const sorted = [...list].sort((a, b) =>
      refScore(b) - refScore(a) ||
      Number(!!b.sku) - Number(!!a.sku) ||
      Number(b.latestCostCents ?? 0 > 0) - Number(a.latestCostCents ?? 0 > 0) ||
      b.name.length - a.name.length
    );
    merges.push({ parent: sorted[0], dups: sorted.slice(1) });
  }

  console.log(`\n${items.length} items · ${merges.length} duplicate groups to merge · ${sizeConflicts.length} flagged (different sizes — review)`);
  console.log('\n=== MERGES (dup → parent) ===');
  for (const m of merges.slice(0, 60)) {
    console.log(`  «${m.parent.name.slice(0, 42)}»  ← ${m.dups.map((d) => d.name.slice(0, 32)).join(' | ')}`);
  }
  if (merges.length > 60) console.log(`  …and ${merges.length - 60} more`);
  if (sizeConflicts.length) {
    console.log('\n=== FLAGGED — different sizes, NOT merged (eyeball these) ===');
    for (const g of sizeConflicts.slice(0, 30)) console.log('   ' + g.map((x) => x.name.slice(0, 30)).join('  |  '));
  }

  if (!CONFIRM) {
    console.log(`\nDRY RUN — nothing changed. To apply: MERGE_CONFIRM=YES ./scripts/merge-duplicate-items.sh`);
    await prisma.$disconnect();
    return;
  }

  let merged = 0;
  for (const m of merges) {
    for (const dup of m.dups) {
      await prisma.$transaction(async (tx) => {
        // Reassign itemId-keyed refs
        await tx.recipeLine.updateMany({ where: { itemId: dup.id }, data: { itemId: m.parent.id } });
        await tx.stocktakeLine.updateMany({ where: { itemId: dup.id }, data: { itemId: m.parent.id } });
        await tx.supplierInvoiceLine.updateMany({ where: { itemId: dup.id }, data: { itemId: m.parent.id } });
        await tx.inventoryMovement.updateMany({ where: { itemId: dup.id }, data: { itemId: m.parent.id } });
        // Reassign stockItemId-keyed refs
        await tx.stockWastageRecord.updateMany({ where: { stockItemId: dup.id }, data: { stockItemId: m.parent.id } });
        await tx.stockDeliveryCheckItem.updateMany({ where: { stockItemId: dup.id }, data: { stockItemId: m.parent.id } });
        await tx.stockReorderNotice.updateMany({ where: { stockItemId: dup.id }, data: { stockItemId: m.parent.id } });
        await tx.stockTransfer.updateMany({ where: { stockItemId: dup.id }, data: { stockItemId: m.parent.id } });
        await tx.squareMenuRecipeMapping.updateMany({ where: { stockItemId: dup.id }, data: { stockItemId: m.parent.id } });
        // Per-venue stock — unique on (venue, stockItemId): merge on conflict.
        const dupVenueStock = await tx.venueStockItem.findMany({ where: { stockItemId: dup.id } });
        for (const vs of dupVenueStock) {
          const existing = await tx.venueStockItem.findUnique({
            where: { venue_stockItemId: { venue: vs.venue, stockItemId: m.parent.id } }
          });
          if (existing) {
            await tx.venueStockItem.update({ where: { id: existing.id }, data: { onHand: (existing.onHand ?? 0) + (vs.onHand ?? 0) } });
            await tx.venueStockItem.delete({ where: { id: vs.id } });
          } else {
            await tx.venueStockItem.update({ where: { id: vs.id }, data: { stockItemId: m.parent.id } });
          }
        }
        await tx.stockItem.delete({ where: { id: dup.id } });
      });
      merged++;
    }
  }
  console.log(`\n✅ Merged ${merged} duplicate items into ${merges.length} parents.`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
