/**
 * Two leftover data fixes from the count-unit corruption cleanup.
 *
 * 1. Manly Spirits Bulk 20L drum — labelled as counted in "L", but the count
 *    history says drums: quantities run 0.275–1.85 and the recent lines value
 *    at exactly qty × $1,320, the drum price. Relabel to drum @ 20,000 ml so
 *    the label matches what staff actually write; the cost basis was already
 *    per drum, so no money changes.
 *
 * 2. Broccolini exists twice — "Broccolinni Box" (the floor/Loaded name, both
 *    venues, counts attached) and "BROCCOLINI box (12 bun)" (invoice-created,
 *    Avalon only). Same box of 12 bunches; both live means split stock and a
 *    doubled par, same disease as the duplicate wines. The floor name
 *    survives, per the wine-merge policy. NOTE: the merge SUMS on-hand where
 *    both records carry the same venue (Avalon 2 + 2 → 4 bunches) — true up
 *    on the next count if both records were counting the same shelf.
 *
 *   node --import tsx scripts/fix-unit-labels-2026-08.ts          # dry run
 *   node --import tsx scripts/fix-unit-labels-2026-08.ts --apply
 */
import { prisma } from '@alma/db';
import { itemsService } from '../src/services/items.service.js';

const DRUM_NAME = 'Manly Spirits Bulk 20Ltr Australian Dry Gin 1 x 20ltr Drum';
const BROC_PARENT = 'Broccolinni Box';
const BROC_DUP = 'BROCCOLINI box (12 bun)';

async function main() {
  const apply = process.argv.includes('--apply');

  // 1 — the drum label
  const drum = await prisma.stockItem.findFirst({
    where: { name: DRUM_NAME, status: 'ACTIVE' },
    include: { venueStock: { select: { venue: true, onHand: true } } }
  });
  if (!drum) {
    console.log(`drum: "${DRUM_NAME}" not found — skipped`);
  } else if (drum.countUnit === 'drum') {
    console.log('drum: already relabelled — skipped');
  } else if (drum.avgCostCents !== 132000) {
    // The relabel is only valid while the cost basis is the $1,320 drum price.
    console.log(`drum: avgCostCents is ${drum.avgCostCents}, expected 132000 — REFUSING, check by hand`);
  } else {
    console.log(
      `drum: ${drum.countUnit} → drum @ 20000ml; on hand ${drum.venueStock
        .map((row) => `${row.venue} ${row.onHand}`)
        .join(', ')} (≈$${((drum.onHand ?? 0) * 1320).toFixed(0)} unchanged)`
    );
    if (apply) {
      await prisma.stockItem.update({
        where: { id: drum.id },
        data: { unit: 'drum', countUnit: 'drum', measurePerCountUnit: 20000 }
      });
      console.log('drum: applied');
    }
  }

  // 2 — the broccolini merge
  const parent = await prisma.stockItem.findFirst({ where: { name: BROC_PARENT, status: 'ACTIVE' } });
  const dup = await prisma.stockItem.findFirst({ where: { name: BROC_DUP, status: 'ACTIVE' } });
  if (!parent || !dup) {
    console.log(`broccolini: ${!parent ? `parent "${BROC_PARENT}"` : `duplicate "${BROC_DUP}"`} not found/active — skipped`);
  } else {
    console.log(`broccolini: merge "${dup.name}" (${dup.id}) into "${parent.name}" (${parent.id})`);
    if (apply) {
      const result = await itemsService.mergeItems({
        parentId: parent.id,
        duplicateIds: [dup.id],
        confirmationText: 'MERGE ITEMS'
      });
      console.log('broccolini: merged', result);
    }
  }

  if (!apply) console.log('\nDRY RUN — re-run with --apply to write.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
