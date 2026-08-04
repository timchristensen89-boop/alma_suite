/**
 * The last of the wrong-unit stocktake lines — the ones the crossover rule
 * could not reach.
 *
 * `fix-wrong-unit-stocktake-lines.ts` converts a line when its raw quantity
 * exceeds one whole count unit's worth of measure, because above that point the
 * two readings have crossed and only the measure one is sane. Thirteen lines
 * sat below that threshold and still valued above $5,000. Looked at one by one
 * they are three different problems, and only one of them is a wrong unit:
 *
 *   Callebaut white chocolate    1095.6395 g against a 2.5kg bag = $119,797
 *       Four decimal places is a weighed figure, and the item is a bag. As
 *       0.438 of a bag it is $47.92. Convert.
 *
 *   Domaine Thompson Pinot Noir  29 "ml" against a 750ml bottle = $6,989
 *   NV Serenello Prosecco        71.1 "ml" against a 750ml bottle = $6,043
 *       These are bottle counts with a stray unit label. 29 bottles of a $241
 *       Pinot is dear but real; 0.039 of a bottle is not a thing anyone counted.
 *       Leave them alone — this is the population that makes a blanket
 *       "convert anything labelled ml" rule dangerous.
 *
 *   Wedge Cerveza Keg            216.9, 179, 110, 52, 49, 34 "ml" = up to $58,563
 *       Neither reading works. As kegs it is $58k of beer in one line. As
 *       millilitres it is 0.022 of a keg, which nobody counted either. The
 *       likeliest truth is litres remaining — but the item also has the wrong
 *       pack size (10L, where the Loaded export names it a 50 L keg), so two
 *       errors are stacked and any number produced here would be invented.
 *
 *       The pack size is a fact and is corrected. The counts are not, so they
 *       are set back to "not counted" — which the schema models explicitly as
 *       null, and which variance skips — rather than given a made-up figure.
 *       Tim's count of 3 August reads 0.00 kegs, so nothing is lost.
 *
 *   node --import tsx scripts/fix-remaining-wrong-unit-lines.ts
 *   node --import tsx scripts/fix-remaining-wrong-unit-lines.ts --apply
 */
import { prisma } from '@alma/db';

/** A 50 L keg, in millilitres — from the Loaded export's own unit column. */
const WEDGE_KEG_ML = 50_000;

/**
 * Only lines worth more than this are touched.
 *
 * Both items carry a mix of sane and absurd lines, and the item name alone
 * cannot tell them apart. The kegs were counted 1.3, 0.3, 1.1, 2 and 1.8 —
 * ordinary keg counts worth $81 to $540 — alongside 49, 52, 110, 179 and 216.9,
 * worth $13,230 to $58,563. Callebaut has 2.5 and 0.396 next to 229.5774 and
 * 1095.6395. Scoping by name and not by value would have converted real bag
 * counts to a tenth of a cent and thrown away six good keg counts.
 *
 * The gap between the two populations is seventeen-fold, so this sits with
 * nine times the clearance above the largest sane line and well below the
 * smallest broken one.
 */
const IMPLAUSIBLE_LINE_CENTS = 500_000;

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  const apply = process.argv.includes('--apply');

  const callebaut = await prisma.stocktakeLine.findMany({
    where: {
      countedQty: { not: null },
      unit: { in: ['g', 'G', 'Gram', 'Grams'] },
      item: { name: { contains: 'Callebaut', mode: 'insensitive' }, measurePerCountUnit: { gt: 0 } }
    },
    select: {
      id: true,
      countedQty: true,
      unit: true,
      item: { select: { name: true, countUnit: true, unit: true, measurePerCountUnit: true, avgCostCents: true } },
      stocktake: { select: { status: true, countedAt: true } }
    }
  });

  const kegs = await prisma.stocktakeLine.findMany({
    where: {
      countedQty: { not: null },
      item: { name: { contains: 'Wedge Cerveza Keg', mode: 'insensitive' } }
    },
    select: {
      id: true,
      countedQty: true,
      unit: true,
      item: { select: { id: true, name: true, avgCostCents: true } },
      stocktake: { select: { status: true, countedAt: true } }
    }
  });

  const lineValue = (qty: number | null, cents: number | null | undefined) =>
    Math.round((qty ?? 0) * (cents ?? 0));
  const callebautBroken = callebaut.filter(
    (l) => lineValue(l.countedQty, l.item.avgCostCents) > IMPLAUSIBLE_LINE_CENTS
  );
  const kegsBroken = kegs.filter((l) => lineValue(l.countedQty, l.item.avgCostCents) > IMPLAUSIBLE_LINE_CENTS);

  console.log(`${apply ? 'APPLYING' : 'DRY RUN'}\n`);
  console.log(
    `Left alone as ordinary counts: ${callebaut.length - callebautBroken.length} Callebaut, ` +
      `${kegs.length - kegsBroken.length} keg line(s) — all under ${money(IMPLAUSIBLE_LINE_CENTS)}.\n`
  );

  console.log(`Callebaut — convert grams to bags (${callebautBroken.length} line(s))`);
  const conversions: Array<{ id: string; next: number; unit: string; from: string }> = [];
  for (const line of callebautBroken) {
    const per = line.item.measurePerCountUnit ?? 0;
    const raw = line.countedQty ?? 0;
    if (per <= 0) continue;
    const next = Math.round((raw / per) * 1000) / 1000;
    const cost = line.item.avgCostCents ?? 0;
    console.log(
      `  ${line.stocktake.countedAt.toISOString().slice(0, 10)} ${line.stocktake.status.padEnd(11)} ` +
        `${raw} ${line.unit} -> ${next} ${line.item.countUnit ?? line.item.unit}   ` +
        `${money(Math.round(raw * cost))} -> ${money(Math.round(next * cost))}`
    );
    conversions.push({ id: line.id, next, unit: line.item.countUnit ?? line.item.unit ?? 'each', from: `${raw} ${line.unit}` });
  }

  console.log(`\nWedge Cerveza Keg — no defensible reading, set back to not-counted (${kegsBroken.length} line(s))`);
  for (const line of kegsBroken) {
    const cost = line.item.avgCostCents ?? 0;
    console.log(
      `  ${line.stocktake.countedAt.toISOString().slice(0, 10)} ${line.stocktake.status.padEnd(11)} ` +
        `${line.countedQty} ${line.unit ?? ''} (${money(Math.round((line.countedQty ?? 0) * cost))}) -> not counted`
    );
  }

  const kegItemIds = Array.from(new Set(kegsBroken.map((line) => line.item.id)));
  console.log(`\nWedge Cerveza Keg pack size -> ${WEDGE_KEG_ML} ml (a 50 L keg), on ${kegItemIds.length} item(s)`);

  const before =
    callebautBroken.reduce((sum, l) => sum + lineValue(l.countedQty, l.item.avgCostCents), 0) +
    kegsBroken.reduce((sum, l) => sum + lineValue(l.countedQty, l.item.avgCostCents), 0);
  const after = conversions.reduce(
    (sum, c, i) => sum + Math.round(c.next * (callebautBroken[i]?.item.avgCostCents ?? 0)),
    0
  );
  console.log(`\nThese lines read as ${money(before)}. They become ${money(after)}.`);

  if (!apply) {
    console.log('\nNothing changed. Re-run with --apply.\n');
    return;
  }

  for (const c of conversions) {
    await prisma.stocktakeLine.update({
      where: { id: c.id },
      data: {
        countedQty: c.next,
        unit: c.unit,
        notes: `Counted ${c.from}; the item is counted in ${c.unit}. Re-read as ${c.next} ${c.unit}.`
      }
    });
  }
  for (const line of kegsBroken) {
    await prisma.stocktakeLine.update({
      where: { id: line.id },
      data: {
        countedQty: null,
        notes:
          `Recorded as ${line.countedQty} ${line.unit ?? ''}, which is neither a believable keg count ` +
          `(${money(Math.round((line.countedQty ?? 0) * (line.item.avgCostCents ?? 0)))}) nor a believable ` +
          `millilitre one. Set back to not-counted rather than guessed; recount to replace it.`
      }
    });
  }
  await prisma.stockItem.updateMany({
    where: { id: { in: kegItemIds } },
    data: { measurePerCountUnit: WEDGE_KEG_ML, measureUnit: 'ml' }
  });

  console.log(`\nConverted ${conversions.length}, cleared ${kegsBroken.length}, corrected ${kegItemIds.length} pack size(s).\n`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
