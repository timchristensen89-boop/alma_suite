/**
 * Repair the par levels that were worked out from counts made in the wrong unit.
 *
 * Several items were counted in millilitres and recorded as bottles (see
 * count-scale.ts). On-hand has since largely self-corrected, but the par levels
 * derived from those counts are still live and still wrong — 21,726 bottles of
 * gin against 2.55 actually held — and they drive the reorder engine.
 *
 * Judged by value, not quantity, the same way the count check is: a par of 2,000
 * tortillas is $340 and entirely believable, while 217 kegs is $58,590 and is
 * not. Measured across every par in production, the largest legitimate one is
 * $7,912 and the smallest corrupt one is $58,590, so the line below sits with
 * roughly 2.5x clearance on both sides.
 *
 * Where the item knows how much its count unit holds, the par is re-read in
 * that measure: 21,726 ml over 750 ml a bottle is 29 bottles, which sits
 * sensibly beside the same item's par of 21 at the other venue. Where that
 * gives an implausible answer the par is cleared rather than guessed — a null
 * par means the ordering engine skips the item, which is honest, and far better
 * than proposing a $1.19M order.
 *
 *   node --import tsx scripts/fix-wrong-unit-pars.ts           # dry run
 *   node --import tsx scripts/fix-wrong-unit-pars.ts --apply
 */
import { prisma } from '@alma/db';

/** A par worth more than this at one venue is not a par. */
const IMPLAUSIBLE_PAR_VALUE_CENTS = 20_000_00;

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  const apply = process.argv.includes('--apply');

  const candidates = await prisma.venueStockItem.findMany({
    where: { parLevel: { gt: 0 } },
    include: {
      stockItem: {
        select: { name: true, countUnit: true, measurePerCountUnit: true, measureUnit: true, avgCostCents: true }
      }
    }
  });

  const rows = candidates
    .map((row) => ({ row, valueCents: Math.round((row.parLevel ?? 0) * (row.stockItem.avgCostCents ?? 0)) }))
    .filter((entry) => entry.valueCents > IMPLAUSIBLE_PAR_VALUE_CENTS)
    .sort((a, b) => b.valueCents - a.valueCents);

  if (rows.length === 0) {
    console.log('No par level is worth more than ' + money(IMPLAUSIBLE_PAR_VALUE_CENTS) + ' — nothing to repair.');
    return;
  }

  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} — ${rows.length} par level(s) worth more than ${money(IMPLAUSIBLE_PAR_VALUE_CENTS)}\n`);
  console.log(
    ['ITEM'.padEnd(36), 'VENUE'.padEnd(12), 'ON HAND'.padStart(8), 'PAR NOW'.padStart(8),
     'WORTH'.padStart(14), 'PAR AFTER'.padStart(10), 'REORDER'.padStart(8)].join(' ')
  );

  for (const { row, valueCents } of rows) {
    const item = row.stockItem;
    const per = item.measurePerCountUnit ?? 0;
    const derived = per > 0 && row.parLevel ? Math.round(row.parLevel / per) : null;
    // Trust the conversion only when the result is itself a believable par.
    const derivedValue = derived === null ? null : Math.round(derived * (item.avgCostCents ?? 0));
    const plausible =
      derived !== null && derived >= 1 && derivedValue !== null && derivedValue <= IMPLAUSIBLE_PAR_VALUE_CENTS;
    const nextPar = plausible ? derived : null;
    const nextReorder = nextPar === null ? null : Math.max(1, Math.round(nextPar / 2));

    console.log(
      [
        item.name.slice(0, 36).padEnd(36),
        (row.venue ?? '').slice(0, 12).padEnd(12),
        (row.onHand ?? 0).toFixed(2).padStart(8),
        String(row.parLevel).padStart(8),
        money(valueCents).padStart(14),
        String(nextPar ?? 'cleared').padStart(10),
        String(nextReorder ?? '—').padStart(8)
      ].join(' ') +
        '   ' +
        (plausible
          ? `read as ${item.measureUnit} at ${per} per ${item.countUnit}`
          : `no sensible conversion — needs a human to set it`)
    );

    if (apply) {
      await prisma.venueStockItem.update({
        where: { id: row.id },
        data: { parLevel: nextPar, reorderPoint: nextReorder }
      });
    }
  }

  console.log(
    apply
      ? '\nApplied. A cleared par means the ordering engine skips that item until somebody sets one.'
      : '\nNothing changed. Re-run with --apply.'
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
