/**
 * Take the unit costs from a Loaded count and put them into Alma.
 *
 * Loaded prints a quantity and a value on every line, so it carries a unit cost
 * for everything the venue holds — and where the two systems disagree, Loaded is
 * the one that has been running the business. Measured across the 1 August
 * sheets, Alma reads flour at $11.40 a kilo where Loaded has $1.12, and there
 * are a handful more like it. Those costs feed stock valuation, recipe costing,
 * menu margins and the reorder engine, so a wrong one is not cosmetic.
 *
 * The cost is derived per *Alma's* count unit, not Loaded's, by dividing the
 * line value by the quantity after unit reconciliation. That matters for the
 * four spirits Loaded counts in millilitres: 20,583.36 mL valued at $1,235.00 is
 * $0.06 a millilitre, but the item is a bottle, and 27.44 bottles at $1,235.00
 * is $45.01 a bottle. Dividing by the raw quantity would have written the first.
 *
 * Lines counted as zero carry no cost — value over zero is nothing, not free —
 * and are skipped rather than zeroing the item.
 *
 *   node --import tsx scripts/sync-costs-from-loaded.ts <sheet.json> [more.json]
 *   node --import tsx scripts/sync-costs-from-loaded.ts <sheet.json> --apply
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { prisma } from '@alma/db';
import {
  parseLoadedStocktake,
  aliasKey,
  catalogueKey,
  reconcileWithEvidence,
  type PdfRow
} from '@alma/shared';

/** Below this the two agree closely enough that rewriting is just churn. */
const MATERIAL_DIFFERENCE = 0.02;

/**
 * The smallest counted quantity a cost may be derived from.
 *
 * Loaded rounds each line's value to the cent, so dividing by the quantity
 * carries an error of half a cent over that quantity: at 0.01 of a unit that is
 * about 3% on an $18 figure, and at 0.001 it would be 30%. Pork belly is
 * derived here from 0.01 kg, which is fine; anything thinner is a rounding
 * artefact wearing the shape of a price.
 */
const MIN_QUANTITY_FOR_COST = 0.01;

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const paths = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (paths.length === 0) throw new Error('Usage: sync-costs-from-loaded.ts <sheet.json> [more.json] [--apply]');

  const items = await prisma.stockItem.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      countUnit: true,
      unit: true,
      avgCostCents: true,
      measurePerCountUnit: true,
      measureUnit: true
    }
  });
  const byExact = new Map(items.map((i) => [i.name.trim().toLowerCase(), i]));
  const index = (key: (name: string) => string) => {
    const map = new Map<string, typeof items>();
    for (const item of items) {
      const k = key(item.name);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(item);
    }
    return map;
  };
  const byAlias = index(aliasKey);
  const byCatalogue = index(catalogueKey);
  const byId = new Map(items.map((i) => [i.id, i]));
  const recorded = new Map<string, (typeof items)[number]>();
  for (const alias of await prisma.stockItemAlias.findMany({ select: { aliasKey: true, stockItemId: true } })) {
    const item = byId.get(alias.stockItemId);
    if (item) recorded.set(alias.aliasKey, item);
  }

  type Change = {
    item: (typeof items)[number];
    was: number | null;
    now: number;
    ratio: number | null;
    from: string;
    sheet: string;
  };
  const changes: Change[] = [];
  const skippedZero: string[] = [];

  for (const path of paths) {
    const sheet = parseLoadedStocktake(JSON.parse(readFileSync(path, 'utf8')) as PdfRow[]);
    if (sheet.isBlank) {
      console.log(`${basename(path)}: blank sheet, no costs to take.`);
      continue;
    }
    for (const line of sheet.lines) {
      const exact = byExact.get(line.name.trim().toLowerCase());
      const alias = byAlias.get(aliasKey(line.name));
      const loose = byCatalogue.get(catalogueKey(line.name));
      const item =
        exact ??
        recorded.get(aliasKey(line.name)) ??
        (alias?.length === 1 ? alias[0] : undefined) ??
        (loose?.length === 1 ? loose[0] : undefined);
      if (!item) continue;

      // Zero counted means no evidence of cost, not a cost of zero.
      if (line.quantity <= 0 || line.valueCents <= 0) {
        if (line.valueCents <= 0 && line.quantity > 0) skippedZero.push(item.name);
        continue;
      }

      const reconciled = reconcileWithEvidence(
        line.unit,
        line.quantity,
        {
          countUnit: item.countUnit ?? item.unit,
          measurePerCountUnit: item.measurePerCountUnit,
          measureUnit: item.measureUnit,
          unitCostCents: item.avgCostCents
        },
        line.valueCents
      );
      if (reconciled.quantity < MIN_QUANTITY_FOR_COST) continue;

      const loadedCost = Math.round(line.valueCents / reconciled.quantity);
      if (loadedCost <= 0) continue;
      const was = item.avgCostCents;
      const ratio = was && was > 0 ? Math.max(loadedCost, was) / Math.min(loadedCost, was) : null;
      if (was != null && ratio != null && ratio - 1 <= MATERIAL_DIFFERENCE) continue;

      changes.push({
        item,
        was,
        now: loadedCost,
        ratio,
        from: `${line.quantity} ${line.unit} = ${money(line.valueCents)}`,
        sheet: basename(path)
      });
    }
  }

  // One cost per item: if two sheets disagree, the dearer evidence wins, since a
  // cost that is too low understates COGS everywhere it is used.
  const perItem = new Map<string, Change>();
  for (const change of changes) {
    const seen = perItem.get(change.item.id);
    if (!seen || change.now > seen.now) perItem.set(change.item.id, change);
  }
  const finalChanges = [...perItem.values()].sort(
    (a, b) => (b.ratio ?? Number.POSITIVE_INFINITY) - (a.ratio ?? Number.POSITIVE_INFINITY)
  );

  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} — ${finalChanges.length} cost(s) differ from Loaded by more than ${MATERIAL_DIFFERENCE * 100}%\n`);
  console.log(['ITEM'.padEnd(40), 'ALMA'.padStart(11), 'LOADED'.padStart(11), 'OUT BY'.padStart(8)].join(' '));
  for (const c of finalChanges.slice(0, 40)) {
    console.log(
      [
        c.item.name.slice(0, 40).padEnd(40),
        (c.was == null ? 'no cost' : money(c.was)).padStart(11),
        money(c.now).padStart(11),
        (c.ratio == null ? 'new' : `${c.ratio.toFixed(1)}x`).padStart(8)
      ].join(' ') + `   ${c.from}`
    );
  }
  if (finalChanges.length > 40) console.log(`  …and ${finalChanges.length - 40} more`);

  const gained = finalChanges.filter((c) => c.was == null).length;
  const bigger = finalChanges.filter((c) => c.was != null && c.now > c.was).length;
  const smaller = finalChanges.filter((c) => c.was != null && c.now < c.was).length;
  console.log(`\n  ${gained} item(s) had no cost at all; ${bigger} go up, ${smaller} come down.`);
  if (skippedZero.length > 0) {
    console.log(`  ${skippedZero.length} line(s) counted with no value — left alone rather than costed at zero.`);
  }

  if (!apply) {
    console.log('\n  Nothing changed. Re-run with --apply.\n');
    return;
  }

  for (const c of finalChanges) {
    await prisma.stockItem.update({
      where: { id: c.item.id },
      data: {
        avgCostCents: c.now,
        notes: `Cost taken from the Loaded count (${c.sheet}): ${c.from}.`
      }
    });
  }
  console.log(`\n  Updated ${finalChanges.length} cost(s) from Loaded.\n`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
