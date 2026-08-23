/**
 * Put the printed menus onto the register's dishes — the dietary marks, and
 * the line of copy under each dish name.
 *
 * Two problems, one source, one matching pass.
 *
 * ALLERGENS. Every dietary chip in the POS filter currently reads 0, because
 * nothing has ever been marked — and the register is careful about that: an
 * unmarked dish is "nobody has checked", never "safe". So the filter is honest
 * and useless at the same time, and a server answering "is this gluten free?"
 * is back to walking to the kitchen.
 *
 * DESCRIPTIONS. The QR menu shows a guest a dish name and a price and nothing
 * else, which is less than the paper menu on their table already tells them.
 * `Recipe.notes` is the field that exists, and it is exactly the wrong one —
 * it holds prep steps and internal asides and must never reach a guest. Hence
 * `guestDescription`, and hence this.
 *
 * The source for both is docs/menu-dietary.tsv, transcribed from the three
 * current prints. Nothing here reads a dish's NAME and decides what is in it,
 * and nothing here writes a description the menu did not print.
 *
 * Three rules, because half the payload is allergen data:
 *
 *   1. Venue-scoped, always. The same dish name is different food at the two
 *      venues — St Alma's guacamole is salsa macha and carries a nut mark,
 *      Avalon's is wakame and does not.
 *   2. A near miss is reported, never applied. Ambiguity comes back for a
 *      human; there is no best-guess branch.
 *   3. A dish that already carries something DIFFERENT from the menu's is left
 *      alone and reported. Filling in a blank is bookkeeping; overruling
 *      somebody who typed it by hand is a decision, and this script cannot
 *      make it. --overwrite if you mean it.
 *
 *   node --import tsx scripts/seed-dish-menu.ts
 *   node --import tsx scripts/seed-dish-menu.ts --apply
 *   node --import tsx scripts/seed-dish-menu.ts --apply --overwrite
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '@alma/db';
import { parseDishDietary, dietaryShort } from '@alma/shared';
import { matchDish, parsePrintedMarks, scoreDish } from '../src/lib/dish-dietary.js';
import { isDrink } from '../src/lib/course-flow.js';

// Which venue to report on. The menus are per-venue and so is the launch, so
// `--venue "Alma Avalon"` narrows everything below to the kitchen you are
// actually asking about.
const VENUE_FLAG = process.argv.indexOf('--venue');
const ONLY_VENUE = VENUE_FLAG > -1 ? process.argv[VENUE_FLAG + 1] ?? null : null;

type MenuRow = {
  venue: string;
  section: string;
  dish: string;
  price: string;
  description: string;
  printed: string;
  apply: string;
  note: string;
};

function readMenu(): MenuRow[] {
  const path = resolve(import.meta.dirname, '../../../docs/menu-dietary.tsv');
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'));
  const header = lines.shift()!.split('\t');
  const at = (cells: string[], name: string) => cells[header.indexOf(name)]?.trim() ?? '';
  return lines.map((line) => {
    const cells = line.split('\t');
    return {
      venue: at(cells, 'venue'),
      section: at(cells, 'section'),
      dish: at(cells, 'dish'),
      price: at(cells, 'price'),
      description: at(cells, 'description'),
      printed: at(cells, 'printed'),
      apply: at(cells, 'apply'),
      note: at(cells, 'note')
    };
  });
}

const show = (tags: string[]) => (tags.length ? tags.map((t) => dietaryShort(t as never)).join(' · ') : '(none)');
const same = (a: string[], b: string[]) => a.length === b.length && a.every((tag, i) => tag === b[i]);

async function main() {
  const apply = process.argv.includes('--apply');
  const overwrite = process.argv.includes('--overwrite');
  const menu = readMenu().filter((row) => !ONLY_VENUE || row.venue === ONLY_VENUE);
  if (ONLY_VENUE) console.log(`Reporting on ${ONLY_VENUE} only.\n`);

  const recipes = await prisma.recipe.findMany({
    where: { status: 'ACTIVE', isPrepRecipe: false },
    select: { id: true, title: true, venue: true, kind: true, category: true, dietary: true, guestDescription: true, salePriceCents: true }
  });

  // Variant children fold under a parent tile on the register (a wine's
  // pours; the fish taco's Battered/Grilled). The menu prints the PARENT —
  // "Barramundi taco" — so a child must not compete for the match: before
  // this filter the battered and grilled rows both scored 1.00 against the
  // one printed line and the seeder threw the pair back as ambiguous forever.
  const variantChildren = new Set(
    (await prisma.posVariantLink.findMany({ select: { parentRecipeId: true, childRecipeId: true } }))
      .filter((link) => link.childRecipeId !== link.parentRecipeId)
      .map((link) => link.childRecipeId)
  );

  // Everything, including what the register will not show. "On the menu, not
  // in the register" used to be one undifferentiated list, which is not
  // actionable: a dish nobody has entered and a dish sitting there with no
  // price need completely different things done to them, and only one of them
  // is a typing job.
  //
  // The register asks for status ACTIVE, isPrepRecipe false and
  // salePriceCents > 0, then the client drops anything tagged to the other
  // venue. A dish can fail any one of those and look identical from the floor:
  // it simply is not there.
  const everything = await prisma.recipe.findMany({
    select: { id: true, title: true, venue: true, kind: true, category: true, status: true, isPrepRecipe: true, salePriceCents: true }
  });
  const whyHidden = (title: string, venue: string): string | null => {
    const candidates = everything.filter(
      (row) => scoreDish(title, row.title) >= 0.6 && (!row.venue || row.venue === venue)
    );
    if (candidates.length === 0) {
      // Maybe it exists but is tagged to the other venue entirely.
      const elsewhere = everything.filter((row) => scoreDish(title, row.title) >= 0.6);
      if (elsewhere.length > 0) {
        // Deduped: two recipes both tagged to Avalon read as "tagged to Alma
        // Avalon, Alma Avalon", which looks like a data error in the report
        // rather than what it is — the same answer twice.
        const venues = [...new Set(elsewhere.map((row) => row.venue ?? '(shared)'))];
        return `tagged to ${venues.join(', ')}, so ${venue}'s register hides it`;
      }
      return null;
    }
    const reasons = candidates.map((row) => {
      if (row.status !== 'ACTIVE') return `"${row.title}" is ${row.status}`;
      if (row.isPrepRecipe) return `"${row.title}" is a prep recipe, not a sellable dish`;
      if (!row.salePriceCents || row.salePriceCents <= 0) return `"${row.title}" has NO PRICE — the register only shows dishes priced above zero`;
      return `"${row.title}" looks sellable; the name is just too far from the menu's to match`;
    });
    // Same reason for two candidate rows is one reason, not two. "Churros is a
    // prep recipe; Churros is a prep recipe" is noise that makes a short list
    // look like a long one.
    return [...new Set(reasons)].join('; ');
  };
  // isDrink is the register's own test, shared with the course planner. The
  // previous version of this line knew about five wine categories and nothing
  // else, so every mezcal and margarita was counted as an unchecked dish.
  const food = recipes
    .filter((row) => !isDrink(row.kind, row.category))
    .filter((row) => !variantChildren.has(row.id))
    .filter((row) => !ONLY_VENUE || row.venue === ONLY_VENUE);

  const byVenue = new Map<string, typeof food>();
  for (const row of food) {
    const venue = row.venue ?? '(shared)';
    if (!byVenue.has(venue)) byVenue.set(venue, []);
    byVenue.get(venue)!.push(row);
  }

  console.log(`${menu.length} dishes on the printed menus, ${food.length} food items in the register.`);
  console.log(`Venues in the register: ${[...byVenue.keys()].sort().join(', ')}\n`);

  const tagWrites: Array<{ id: string; title: string; venue: string; tags: string[] }> = [];
  const descWrites: Array<{ id: string; title: string; venue: string; description: string }> = [];
  const tagsAlreadyRight: string[] = [];
  const descAlreadyRight: string[] = [];
  const tagDisagree: string[] = [];
  const descDisagree: string[] = [];
  const ambiguous: string[] = [];
  const unmatched: string[] = [];
  const flagged: string[] = [];
  // Matched, marked, described — and still not on the register, because the
  // register only shows dishes priced above zero. This one is easy to miss
  // precisely because everything else about the dish is right.
  const priceless: string[] = [];
  // The register's price against the printed one. REPORTED, never written:
  // a price is money, and a script that quietly re-prices a menu because a PDF
  // disagreed with it is not something anybody asked for.
  const priceDiff: string[] = [];

  for (const row of menu) {
    const pool = byVenue.get(row.venue) ?? [];
    const wanted = parseDishDietary(row.apply.split(',').map((tag) => tag.trim()).filter(Boolean));
    const printed = parsePrintedMarks(row.printed);

    // Anything where the transcription deliberately differs from the print, or
    // where the print used a mark nobody recognises, is surfaced every run —
    // these are questions for the kitchen, not defects to be fixed silently.
    if (row.note) flagged.push(`  ${row.venue} · ${row.dish}\n      ${row.note}`);
    if (printed.unknown.length) {
      flagged.push(`  ${row.venue} · ${row.dish}\n      unrecognised mark on the print: ${printed.unknown.join(', ')}`);
    }

    const match = matchDish(row.dish, pool.map((item) => item.title));
    if (match.kind === 'unmatched') {
      const closest = match.closest ? `  (closest: ${match.closest.registerTitle} @ ${match.closest.score.toFixed(2)})` : '';
      const why = whyHidden(row.dish, row.venue);
      unmatched.push(`  ${row.venue} · ${row.dish}${closest}${why ? `\n      ${why}` : ''}`);
      continue;
    }
    if (match.kind === 'ambiguous') {
      const options = match.candidates.map((c) => `${c.registerTitle} (${c.score.toFixed(2)})`).join('  vs  ');
      // A tie at 1.00 is not really an ambiguous MATCH — it means the register
      // holds the same dish twice, usually once bare and once with a piece
      // count. That is a duplicate to merge in Stock, not a judgement call
      // about which dish the menu meant, so it is said differently.
      const duplicate = match.candidates.length > 1 && match.candidates.every((c) => c.score === 1);
      ambiguous.push(
        duplicate
          ? `  ${row.venue} · ${row.dish}\n      DUPLICATE IN THE REGISTER — the same dish twice: ${options}`
          : `  ${row.venue} · ${row.dish}  ->  ${options}`
      );
      continue;
    }

    const item = pool.find((candidate) => candidate.title === match.registerTitle)!;
    if (!item.salePriceCents || item.salePriceCents <= 0) {
      priceless.push(`  ${row.venue} · ${item.title}`);
    } else if (row.price) {
      const printed = Math.round(Number(row.price) * 100);
      if (Number.isFinite(printed) && printed > 0 && printed !== item.salePriceCents) {
        const money = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
        priceDiff.push(
          `  ${row.venue} · ${item.title.padEnd(38)} register ${money(item.salePriceCents).padEnd(7)} menu ${money(printed)}`
        );
      }
    }

    // ── The dietary marks ──
    const current = parseDishDietary(item.dietary);
    if (same(current, wanted)) {
      tagsAlreadyRight.push(`  ${row.venue} · ${item.title}  ${show(wanted)}`);
    } else if (current.length && !overwrite) {
      tagDisagree.push(`  ${row.venue} · ${item.title}: register ${show(current)} vs menu ${show(wanted)}`);
    } else {
      tagWrites.push({ id: item.id, title: item.title, venue: row.venue, tags: wanted });
    }

    // ── The guest description ──
    const description = row.description.trim();
    const existing = item.guestDescription?.trim() ?? '';
    if (!description) {
      // A dish the menu prints bare. No description is the honest state here;
      // an invented one would be worse than none.
    } else if (existing === description) {
      descAlreadyRight.push(`  ${row.venue} · ${item.title}`);
    } else if (existing && !overwrite) {
      descDisagree.push(`  ${row.venue} · ${item.title}\n      register: ${existing}\n      menu:     ${description}`);
    } else {
      descWrites.push({ id: item.id, title: item.title, venue: row.venue, description });
    }
  }

  if (flagged.length) {
    console.log(`Read the menu, then read these (${flagged.length}) — every one is a question for the kitchen:`);
    for (const line of flagged) console.log(line);
    console.log('');
  }
  if (tagWrites.length) {
    console.log(`${tagWrites.length} dish(es) to mark:`);
    for (const write of tagWrites) console.log(`  ${write.venue.padEnd(12)} ${write.title.padEnd(42)} ${show(write.tags)}`);
    console.log('');
  }
  if (descWrites.length) {
    console.log(`${descWrites.length} description(s) to write:`);
    for (const write of descWrites) console.log(`  ${write.venue.padEnd(12)} ${write.title.padEnd(42)} ${write.description}`);
    console.log('');
  }
  if (tagsAlreadyRight.length) console.log(`Dietary already correct (${tagsAlreadyRight.length})`);
  if (descAlreadyRight.length) console.log(`Description already correct (${descAlreadyRight.length})`);
  if (tagsAlreadyRight.length || descAlreadyRight.length) console.log('');
  if (tagDisagree.length) {
    console.log(`Already marked, and the register disagrees with the menu — LEFT ALONE (${tagDisagree.length}):`);
    for (const line of tagDisagree) console.log(line);
    console.log('  Re-run with --overwrite to make the menu win.\n');
  }
  if (descDisagree.length) {
    console.log(`Already described, and somebody's wording differs from the print — LEFT ALONE (${descDisagree.length}):`);
    for (const line of descDisagree) console.log(line);
    console.log('  Re-run with --overwrite to make the menu win.\n');
  }
  if (ambiguous.length) {
    console.log(`Two register dishes fit equally well, so neither was used (${ambiguous.length}):`);
    console.log('  (a DUPLICATE line is a Stock cleanup; anything else is a question about which dish the menu means)');
    for (const line of ambiguous) console.log(line);
    console.log('');
  }
  if (priceDiff.length) {
    console.log(`The register and the print disagree on price (${priceDiff.length}):`);
    for (const line of priceDiff) console.log(line);
    console.log('  Nothing was changed. Prices are money — fix whichever is wrong in Stock, or reprint.\n');
  }
  if (priceless.length) {
    console.log(`Priced at nothing, so the register hides them (${priceless.length}) — these ARE in Stock and this run marked them, but nobody can ring one up:`);
    for (const line of priceless) console.log(line);
    console.log('  Give each a price in Stock and it appears at the till.\n');
  }
  if (unmatched.length) {
    console.log(`On the menu, not in the register (${unmatched.length}) — nobody can order these, at the till or on the QR menu:`);
    console.log('  (a line beneath a dish says why it is hidden; no line means no recipe exists at all)');
    for (const line of unmatched) console.log(line);
    console.log('');
  }

  // The other direction, and the one that matters at the table: a dish a guest
  // can order tonight that still carries no marks, or no words, at all.
  // Grouped by category rather than listed flat. A bare list of forty names
  // out of hundreds tells you the number is big and nothing else; the shape of
  // it — which sections are covered and which are untouched — is the part you
  // can act on.
  const byCategory = (rows: typeof food, heading: string, why: string) => {
    if (!rows.length) return;
    const groups = new Map<string, string[]>();
    for (const row of rows) {
      const key = `${row.venue ?? '(shared)'} · ${row.category ?? '(no category)'}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row.title);
    }
    console.log(`${heading} (${rows.length}) — ${why}`);
    for (const [key, titles] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${key}  (${titles.length})`);
      for (const title of titles.slice(0, 6)) console.log(`      ${title}`);
      if (titles.length > 6) console.log(`      ... and ${titles.length - 6} more`);
    }
    console.log('');
  };

  const marked = new Set(tagWrites.map((write) => write.id));
  byCategory(
    food.filter((row) => !marked.has(row.id) && parseDishDietary(row.dietary).length === 0),
    'Still unmarked after this run',
    'the filter reads these as "nobody has checked"'
  );
  const described = new Set(descWrites.map((write) => write.id));
  byCategory(
    food.filter((row) => !described.has(row.id) && !row.guestDescription?.trim()),
    'Still without a description',
    'a guest sees the name and the price and nothing else'
  );

  if (!apply) {
    console.log('Dry run. Nothing written. Re-run with --apply to write the above.');
    await prisma.$disconnect();
    return;
  }

  for (const write of tagWrites) {
    await prisma.recipe.update({ where: { id: write.id }, data: { dietary: write.tags } });
  }
  for (const write of descWrites) {
    await prisma.recipe.update({ where: { id: write.id }, data: { guestDescription: write.description } });
  }
  console.log(`Marked ${tagWrites.length} dish(es), described ${descWrites.length}.`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
