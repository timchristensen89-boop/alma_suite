/**
 * Repair the counted quantities that were recorded in the wrong unit.
 *
 * The variance report compares what was counted against what should be there,
 * and "what should be there" starts from the previous count. While the old
 * counts hold millilitres in a field that means bottles, the report shows St
 * Alma A$1.5M short of stock it never had:
 *
 *   Manly Spirits Triple Sec No Sugar   counted 14.13 bottle
 *                                       expected 16,850 bottle   -A$645,992
 *
 * The lines say it themselves. Each carries the unit it was counted in, and on
 * these seven that unit is "mL" while the item is counted in bottles. Nothing
 * ever compared the two.
 *
 * The line between a wrong unit and a large count is the item's own bottle
 * size. Count 21,725 bottles and read it as millilitres and you get 29 bottles;
 * count 29 bottles and read those as millilitres and you get 0.04 of one. The
 * two readings cross at exactly `measurePerCountUnit`, so above that point the
 * measure reading is the only sane one. In this data the separation is not
 * close: across 2,120 lines counted in millilitres against a bottle, the median
 * is 1.28 and the 99th percentile is 42.86, while the smallest broken line is
 * 4,010 — ninety times clear of the threshold and a hundred clear of anything real.
 *
 *   node --import tsx scripts/fix-wrong-unit-stocktake-lines.ts
 *   node --import tsx scripts/fix-wrong-unit-stocktake-lines.ts --apply
 */
import { prisma } from '@alma/db';
import { reconcileLoadedQuantity } from '@alma/shared';

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  const apply = process.argv.includes('--apply');

  const lines = await prisma.stocktakeLine.findMany({
    where: { countedQty: { not: null }, unit: { not: null }, itemId: { not: null } },
    select: {
      id: true,
      countedQty: true,
      unit: true,
      label: true,
      stocktake: { select: { id: true, name: true, venue: true, status: true, countedAt: true } },
      item: {
        select: {
          name: true,
          unit: true,
          countUnit: true,
          measurePerCountUnit: true,
          measureUnit: true,
          avgCostCents: true
        }
      }
    }
  });

  const broken = [];
  for (const line of lines) {
    const item = line.item;
    const per = item?.measurePerCountUnit ?? 0;
    const raw = line.countedQty ?? 0;
    // Above one count unit's worth of measure, the two readings have crossed
    // over and only the measure one can be what was meant.
    if (!item || per <= 0 || raw <= per) continue;

    const result = reconcileLoadedQuantity(line.unit ?? '', raw, {
      countUnit: item.countUnit ?? item.unit,
      measurePerCountUnit: item.measurePerCountUnit,
      measureUnit: item.measureUnit
    });
    if (!result.converted) continue;
    // A conversion that leaves the number alone found nothing wrong — items
    // whose count unit already holds one unit of measure ("Water", 1 ml each)
    // come through here unchanged, and rewriting them would only add noise.
    if (result.quantity === raw) continue;

    const cost = item.avgCostCents ?? 0;
    broken.push({
      line,
      item,
      next: result.quantity,
      wasCents: Math.round(raw * cost),
      nowCents: Math.round(result.quantity * cost)
    });
  }

  if (broken.length === 0) {
    console.log('No counted quantity reads as the wrong unit. Nothing to repair.');
    return;
  }

  broken.sort((a, b) => b.wasCents - a.wasCents);
  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} — ${broken.length} counted quantit(ies) recorded in the wrong unit\n`);
  console.log(
    ['ITEM'.padEnd(34), 'COUNT'.padEnd(12), 'STATUS'.padEnd(11), 'WAS'.padStart(12), 'READS AS'.padStart(11), 'NOW'.padStart(12)].join(' ')
  );

  for (const row of broken) {
    console.log(
      [
        row.item.name.slice(0, 34).padEnd(34),
        (row.line.stocktake.countedAt.toISOString().slice(0, 10) + ' ' + (row.line.stocktake.venue ?? '')).slice(0, 12).padEnd(12),
        row.line.stocktake.status.padEnd(11),
        `${row.line.countedQty} ${row.line.unit}`.padStart(12),
        `${row.next} ${row.item.countUnit ?? row.item.unit}`.padStart(11),
        money(row.nowCents).padStart(12)
      ].join(' ') + `   was ${money(row.wasCents)}`
    );
  }

  const locked = broken.filter((row) => row.line.stocktake.status === 'LOCKED');
  if (locked.length > 0) {
    console.log(
      `\n  ${locked.length} of these sit on a LOCKED count. That count is the baseline the variance` +
        `\n  report measures against, which is why the report reads A$1.5M short. Correcting it` +
        `\n  changes a figure somebody may have already seen — worth saying out loud.`
    );
  }

  const before = broken.reduce((total, row) => total + row.wasCents, 0);
  const after = broken.reduce((total, row) => total + row.nowCents, 0);
  console.log(`\n  These lines read as ${money(before)} of stock. They are ${money(after)}.`);

  if (!apply) {
    console.log('\n  Nothing changed. Re-run with --apply.\n');
    return;
  }

  for (const row of broken) {
    await prisma.stocktakeLine.update({
      where: { id: row.line.id },
      data: {
        countedQty: row.next,
        unit: row.item.countUnit ?? row.item.unit,
        notes: `Counted ${row.line.countedQty} ${row.line.unit}; recorded against an item counted in ${
          row.item.countUnit ?? row.item.unit
        }. Re-read as ${row.next} ${row.item.countUnit ?? row.item.unit}.`
      }
    });
  }

  console.log(`\n  Repaired ${broken.length} line(s). Re-run the variance report.\n`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
