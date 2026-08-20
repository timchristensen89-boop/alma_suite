/**
 * Give every wine on the printed list a grape, a region and a vintage.
 *
 * The catalogue knows a wine as a Recipe: a title and a price. So the register
 * cannot answer "a Riesling under $90 from the Clare", and the same bottle sits
 * in it three times, because each pour is its own row — "BenMarco Malbec
 * 150mL", "...250mL", "...750mL". The printed drinks lists already carry
 * everything that is missing: producer, grape, region, vintage, the style bands
 * ("Crisp & refreshing"), the pairing marks (seafood / rich / veg) and a
 * tasting note on most bottles. docs/wine-list.tsv is those two lists,
 * transcribed.
 *
 * This reads that file, matches each wine to the POS items that sell it, and
 * writes a Wine with a WinePour per size. It NEVER writes a price: money stays
 * on the Recipe, where the till and the reports already read it. The prices in
 * the file are used only to tell one pour size from another when a title is
 * ambiguous, and to report where the register and the menu disagree — which,
 * measured on production, is nearly everywhere.
 *
 * Matching is by name, so it is checked rather than trusted: a dry run prints
 * what it would link, what is ambiguous and what it cannot find, and writes
 * nothing. Only --apply commits, and only the confident matches.
 *
 *   node --import tsx scripts/seed-wine-list.ts
 *   node --import tsx scripts/seed-wine-list.ts --apply
 *   node --import tsx scripts/seed-wine-list.ts --venue "St Alma"
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '@alma/db';
import { poursizeOf, scoreCandidate, tokens } from '../src/lib/wine-match.js';

type Row = {
  venue: string;
  vintage: number | null;
  producer: string;
  cuvee: string | null;
  grape: string | null;
  region: string | null;
  origin: string | null;
  section: string | null;
  band: string | null;
  pours: Array<{ ml: number; priceCents: number }>;
  pairs: string[];
  flags: string[];
  note: string | null;
};

const FILE = resolve(import.meta.dirname, '../../../docs/wine-list.tsv');

function readList(): Row[] {
  const [header, ...lines] = readFileSync(FILE, 'utf8').trim().split('\n');
  const cols = header.split('\t');
  const want = ['venue','vintage','producer','cuvee','grape','region','origin','section','band','pours','pairs','flags','note'];
  if (cols.join(',') !== want.join(',')) throw new Error(`Unexpected columns in ${FILE}: ${cols.join(',')}`);
  return lines.map((line, index) => {
    const f = line.split('\t');
    // Trailing empty columns vanish through most editors and any spreadsheet
    // round trip, so pad them back. Too MANY columns is real corruption.
    while (f.length < want.length) f.push('');
    if (f.length !== want.length) throw new Error(`Row ${index + 2} has ${f.length} columns, expected ${want.length}`);
    const [venue, vintage, producer, cuvee, grape, region, origin, section, band, pours, pairs, flags, note] = f;
    return {
      venue,
      vintage: vintage === 'NV' || !vintage ? null : Number(vintage),
      producer,
      cuvee: cuvee || null,
      grape: grape || null,
      region: region || null,
      origin: origin || null,
      section: section || null,
      band: band || null,
      pours: pours
        .split('|')
        .filter(Boolean)
        .map((part) => {
          const [ml, price] = part.split(':');
          return { ml: Number(ml), priceCents: Number(price) * 100 };
        }),
      pairs: pairs.split(',').filter(Boolean),
      flags: flags.split(',').filter(Boolean),
      note: note || null
    };
  });
}

const CONFIDENT = 0.62;
/** How far clear of the runner-up a match has to be to count as unambiguous. */
const MARGIN = 0.08;

async function main() {
  const apply = process.argv.includes('--apply');
  const venueArg = process.argv.indexOf('--venue');
  const onlyVenue = venueArg === -1 ? null : process.argv[venueArg + 1];

  const rows = readList().filter((row) => !onlyVenue || row.venue === onlyVenue);

  const recipes = await prisma.recipe.findMany({
    where: {
      status: 'ACTIVE',
      isPrepRecipe: false,
      OR: [
        { category: { contains: 'Wine', mode: 'insensitive' } },
        { category: { contains: 'Sparkling', mode: 'insensitive' } },
        { category: { contains: 'Rose', mode: 'insensitive' } }
      ]
    },
    select: { id: true, title: true, venue: true, salePriceCents: true, category: true }
  });
  const pool = recipes.map((recipe) => ({ ...recipe, ml: poursizeOf(recipe.title), tokens: tokens(recipe.title) }));

  const linked: Array<{ row: Row; pours: Array<{ ml: number; recipe: (typeof pool)[number]; score: number }> }> = [];
  const ambiguous: string[] = [];
  const missing: string[] = [];
  const priceGaps: string[] = [];
  const claimed = new Set<string>();
  const contest = new Map<string, string[]>();
  /** Wines that would have taken a register row another wine already holds. */
  const contested: string[] = [];

  for (const row of rows) {
    // Who made it is the strong signal; the grape is a weak one, shared by
    // dozens of wines. Scoring on both together let "R. Paulazzo Pinot Noir"
    // tie with "Nielson Pinot Noir" on the grape alone, so a match now has to
    // share at least one word of the producer or the cuvee before the grape
    // counts for anything.
    const maker = tokens(`${row.producer} ${row.cuvee ?? ''}`);
    // `section` earns its place here and nowhere else: the register appends the
    // style to the title ("R. Paulazzo Rose") where the list keeps it in a
    // column, and an unexplained word costs the match. It is deliberately NOT
    // in `maker`, so it can never make a match on its own.
    const wanted = tokens(`${row.producer} ${row.cuvee ?? ''} ${row.grape ?? ''} ${row.section ?? ''}`);
    const found: Array<{ ml: number; recipe: (typeof pool)[number]; score: number }> = [];

    for (const pour of row.pours) {
      const candidates = pool
        .filter((recipe) => recipe.venue === row.venue && recipe.ml === pour.ml && !claimed.has(recipe.id))
        .map((recipe) => ({
          recipe,
          score: scoreCandidate({ wanted, maker, title: recipe.title, recipeTokens: recipe.tokens, rowVintage: row.vintage })
        }))
        .sort((a, b) => b.score - a.score);

      const best = candidates[0];
      const next = candidates[1];
      // The vintage belongs in the label: without it the contested report reads
      // "Rockford Basket Press taken by Rockford Basket Press".
      const label = `${row.venue} · ${row.vintage ?? 'NV'} ${row.producer}${row.cuvee ? ` '${row.cuvee}'` : ''} ${pour.ml}mL`;

      if (!best || best.score < CONFIDENT) {
        // Somebody else already holds the row this wine would have matched:
        // two vintages of the same bottle, and only one of them in the
        // register. Worth a human eye, not a silent first-come win.
        const taken = pool
          .filter((recipe) => recipe.venue === row.venue && recipe.ml === pour.ml && claimed.has(recipe.id))
          .find(
            (recipe) =>
              scoreCandidate({ wanted, maker, title: recipe.title, recipeTokens: recipe.tokens, rowVintage: row.vintage }) >=
              CONFIDENT
          );
        if (taken) contested.push(`${label}  →  ${taken.title}, already taken by ${(contest.get(taken.id) ?? []).join(', ')}`);
        else missing.push(`${label}${best ? `  (closest: ${best.recipe.title} @ ${best.score.toFixed(2)})` : ''}`);
        continue;
      }
      if (next && best.score - next.score < MARGIN) {
        ambiguous.push(`${label}  →  ${best.recipe.title} (${best.score.toFixed(2)}) vs ${next.recipe.title} (${next.score.toFixed(2)})`);
        continue;
      }
      claimed.add(best.recipe.id);
      contest.set(best.recipe.id, [...(contest.get(best.recipe.id) ?? []), label]);
      found.push({ ml: pour.ml, recipe: best.recipe, score: best.score });
      // Reported, never corrected: prices are the venue's call and change with
      // the print run.
      if (best.recipe.salePriceCents === null) {
        priceGaps.push(`${label}: no price in the register (menu says $${pour.priceCents / 100})`);
      } else if (best.recipe.salePriceCents !== pour.priceCents) {
        priceGaps.push(
          `${label}: register $${(best.recipe.salePriceCents / 100).toFixed(2)} vs menu $${(pour.priceCents / 100).toFixed(2)}`
        );
      }
    }

    if (found.length > 0) linked.push({ row, pours: found });
  }

  const report = (title: string, lines: string[]) => {
    if (lines.length === 0) return;
    console.log(`\n${title} (${lines.length})`);
    for (const line of lines) console.log(`  ${line}`);
  };

  console.log(`${rows.length} wines on the list, ${pool.length} wine items in the register.`);
  console.log(`${linked.length} wines matched to ${linked.reduce((sum, entry) => sum + entry.pours.length, 0)} pours.`);
  const orphans = pool
    .filter((recipe) => !claimed.has(recipe.id))
    .map((recipe) => `${recipe.venue} · ${recipe.title}`)
    .sort();

  report('Ambiguous — two candidates too close to call, skipped', ambiguous);
  report('Contested — more than one wine fits the same register row', contested);
  report('On the list, not in the register', missing);
  report('In the register, on no printed list — candidates to archive', orphans);
  report('Price disagreements (reported only, nothing written)', priceGaps);

  if (!apply) {
    console.log('\nDry run. Nothing written. Re-run with --apply to commit the matched wines.');
    await prisma.$disconnect();
    return;
  }

  let created = 0;
  let updated = 0;
  for (const [index, { row, pours }] of linked.entries()) {
    const existing = await prisma.wine.findFirst({
      where: { venue: row.venue, producer: row.producer, cuvee: row.cuvee, vintage: row.vintage },
      select: { id: true }
    });
    const data = {
      venue: row.venue,
      producer: row.producer,
      cuvee: row.cuvee,
      grape: row.grape,
      region: row.region,
      origin: row.origin,
      vintage: row.vintage,
      section: row.section,
      styleBand: row.band,
      pairsWith: row.pairs,
      tastingNote: row.note,
      sommelierPour: row.flags.includes('som'),
      limitedStock: row.flags.includes('ltd'),
      serveChilled: row.flags.includes('chilled'),
      sortOrder: index
    };
    const wine = existing
      ? await prisma.wine.update({ where: { id: existing.id }, data })
      : await prisma.wine.create({ data });
    existing ? (updated += 1) : (created += 1);

    for (const [pourIndex, pour] of pours.entries()) {
      // A recipe can only be one pour of one wine, so re-pointing it moves it
      // rather than duplicating it.
      await prisma.winePour.deleteMany({ where: { recipeId: pour.recipe.id, NOT: { wineId: wine.id } } });
      await prisma.winePour.upsert({
        where: { recipeId: pour.recipe.id },
        create: { wineId: wine.id, recipeId: pour.recipe.id, ml: pour.ml, sortOrder: pourIndex },
        update: { wineId: wine.id, ml: pour.ml, sortOrder: pourIndex }
      });
    }
  }

  console.log(`\nWrote ${created} new wines and updated ${updated}. No price was touched.`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
