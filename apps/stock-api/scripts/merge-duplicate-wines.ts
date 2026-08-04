/**
 * Merge the wines that exist in Alma twice.
 *
 * Every one of these is the same bottle recorded under two names: the one the
 * floor uses ("Greystone Pinot Gris 2024") and the one a supplier invoice
 * created ("2023 Greystone Pinot Gris (Case of 12)"). Both are live, which is
 * the part that matters — measured on production, the invoice-created copies
 * were last counted 7 June and carry the recipe links, while the floor-named
 * copies were counted 3 August by the Loaded import and carry none. So the
 * stock is split across two records, each with its own par, which is why the
 * pars read as nonsense: Atlas Riesling 86 and 6, R. Paulazzo Rose 114 and 27.
 *
 * The floor name is kept as the surviving record, for three reasons: it is what
 * staff say and count, it is what the Loaded export matches on, and it has no
 * vintage in it — a name with "2023" in it goes stale every year, which is how
 * the second copy appeared in the first place.
 *
 * Only unambiguous pairs are touched: exactly two active items sharing a
 * catalogue key, exactly one of which is a "(Case of N)". Anything else is
 * printed and skipped. That rule protects the cases that are not duplicates at
 * all — Rockford Basket Press exists as 2004, 2017 and 2018, three genuinely
 * different wines at $325, $185 and $210, and a rule based on name similarity
 * alone would have merged them into one.
 *
 *   node --import tsx scripts/merge-duplicate-wines.ts
 *   node --import tsx scripts/merge-duplicate-wines.ts --apply
 */
import { prisma } from '@alma/db';
import { itemsService } from '../src/services/items.service.js';

/** Same normalisation the catalogue matcher uses: drop vintage, case size, punctuation. */
function catalogueKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(case of \d+\)/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/[''`"]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const isCaseNamed = (name: string) => /\(case of \d+\)/i.test(name);

async function main() {
  const apply = process.argv.includes('--apply');

  const items = await prisma.stockItem.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, avgCostCents: true, venueStock: { select: { venue: true, onHand: true, parLevel: true } } }
  });

  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const key = catalogueKey(item.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  const merges: Array<{ parent: (typeof items)[number]; dup: (typeof items)[number] }> = [];
  const skipped: Array<{ key: string; why: string; names: string[] }> = [];

  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const cased = group.filter((item) => isCaseNamed(item.name));
    const plain = group.filter((item) => !isCaseNamed(item.name));
    if (group.length === 2 && cased.length === 1 && plain.length === 1) {
      merges.push({ parent: plain[0]!, dup: cased[0]! });
    } else {
      skipped.push({
        key,
        why:
          cased.length === 0
            ? 'no invoice-created copy — these look like different vintages'
            : `${group.length} copies, ${cased.length} of them "(Case of …)" — needs a person`,
        names: group.map((item) => item.name)
      });
    }
  }

  const money = (c: number | null) => (c == null ? 'no cost' : `$${(c / 100).toFixed(2)}`);
  const onHand = (item: (typeof items)[number]) =>
    item.venueStock.reduce((sum, row) => sum + (row.onHand ?? 0), 0);
  const maxPar = (item: (typeof items)[number]) =>
    item.venueStock.reduce((max, row) => Math.max(max, row.parLevel ?? 0), 0);

  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} — ${merges.length} unambiguous pair(s), ${skipped.length} skipped\n`);
  for (const { parent, dup } of merges) {
    console.log(`  keep  ${parent.name}`);
    console.log(`          on hand ${onHand(parent).toFixed(1)}, par ${maxPar(parent)}, ${money(parent.avgCostCents)}`);
    console.log(`  fold  ${dup.name}`);
    console.log(`          on hand ${onHand(dup).toFixed(1)}, par ${maxPar(dup)}, ${money(dup.avgCostCents)}`);
    console.log(`     -> on hand becomes ${(onHand(parent) + onHand(dup)).toFixed(1)}, par stays ${maxPar(parent)}\n`);
  }

  if (skipped.length > 0) {
    console.log('  Skipped — not an unambiguous pair:');
    for (const s of skipped) {
      console.log(`    ${s.why}`);
      for (const n of s.names) console.log(`      - ${n}`);
    }
    console.log();
  }

  /**
   * Two things the merge itself will not do, because it keeps the parent's
   * fields and drops the duplicate's.
   *
   * A survivor with no cost would inherit the duplicate's stock and value it at
   * nothing — Eperosa Magnolia Semillon has no cost on the floor-named copy and
   * $30.00 on the invoice one, and folding 16.1 bottles into it would quietly
   * take $483 off the stock valuation. So the cost is carried across when the
   * survivor has none.
   *
   * Where both have a cost and they disagree badly, neither is safe to pick
   * automatically: Kendall Jackson reads $55.90 against $10.83, and one of
   * those is a case price on a bottle line. Those are named and left alone.
   */
  const COST_DISAGREEMENT_LIMIT = 2;
  const carriedCost: string[] = [];
  const costConflicts: string[] = [];
  for (const { parent, dup } of merges) {
    if (parent.avgCostCents == null && dup.avgCostCents != null) {
      carriedCost.push(`${parent.name} <- ${money(dup.avgCostCents)}`);
    } else if (parent.avgCostCents && dup.avgCostCents) {
      const ratio = Math.max(parent.avgCostCents, dup.avgCostCents) / Math.min(parent.avgCostCents, dup.avgCostCents);
      if (ratio > COST_DISAGREEMENT_LIMIT) {
        costConflicts.push(
          `${parent.name}: keeping ${money(parent.avgCostCents)}, folding away ${money(dup.avgCostCents)} (${ratio.toFixed(1)}x apart)`
        );
      }
    }
  }
  if (carriedCost.length > 0) {
    console.log('  Cost carried from the folded copy (the survivor had none):');
    for (const line of carriedCost) console.log(`    ${line}`);
    console.log();
  }
  if (costConflicts.length > 0) {
    console.log('  The two copies disagree on cost — check these after merging:');
    for (const line of costConflicts) console.log(`    ${line}`);
    console.log();
  }

  if (!apply) {
    console.log('  Nothing changed. Re-run with --apply.\n');
    return;
  }

  let done = 0;
  for (const { parent, dup } of merges) {
    try {
      // Carry the cost first: after the merge the duplicate is archived and its
      // cost is no longer reachable.
      if (parent.avgCostCents == null && dup.avgCostCents != null) {
        await prisma.stockItem.update({ where: { id: parent.id }, data: { avgCostCents: dup.avgCostCents } });
      }
      // The service requires the same typed confirmation the UI asks for.
      await itemsService.mergeItems({
        parentId: parent.id,
        duplicateIds: [dup.id],
        confirmationText: 'MERGE ITEMS'
      });
      done++;
    } catch (error) {
      console.log(`  FAILED ${parent.name}: ${(error as Error).message}`);
    }
  }
  console.log(`\n  Merged ${done} of ${merges.length}. The folded copies are ARCHIVED, not deleted.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
