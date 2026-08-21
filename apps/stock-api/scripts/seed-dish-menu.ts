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
import { matchDish, parsePrintedMarks } from '../src/lib/dish-dietary.js';

const DRINK_CATEGORIES = new Set(['Red Wine', 'White Wine', 'Rose', 'Sparkling Wine', 'Fortified']);

type MenuRow = {
  venue: string;
  section: string;
  dish: string;
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
  const menu = readMenu();

  const recipes = await prisma.recipe.findMany({
    where: { status: 'ACTIVE', isPrepRecipe: false },
    select: { id: true, title: true, venue: true, category: true, dietary: true, guestDescription: true }
  });
  const food = recipes.filter((row) => !DRINK_CATEGORIES.has(row.category ?? ''));

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
      unmatched.push(`  ${row.venue} · ${row.dish}${closest}`);
      continue;
    }
    if (match.kind === 'ambiguous') {
      const options = match.candidates.map((c) => `${c.registerTitle} (${c.score.toFixed(2)})`).join('  vs  ');
      ambiguous.push(`  ${row.venue} · ${row.dish}  ->  ${options}`);
      continue;
    }

    const item = pool.find((candidate) => candidate.title === match.registerTitle)!;

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
    for (const line of ambiguous) console.log(line);
    console.log('');
  }
  if (unmatched.length) {
    console.log(`On the menu, not in the register (${unmatched.length}):`);
    for (const line of unmatched) console.log(line);
    console.log('');
  }

  // The other direction, and the one that matters at the table: a dish a guest
  // can order tonight that still carries no marks, or no words, at all.
  const marked = new Set(tagWrites.map((write) => write.id));
  const stillBlank = food.filter((row) => !marked.has(row.id) && parseDishDietary(row.dietary).length === 0);
  if (stillBlank.length) {
    console.log(`Still unmarked after this run (${stillBlank.length}) — the filter reads these as "nobody has checked":`);
    for (const row of stillBlank.slice(0, 40)) console.log(`  ${(row.venue ?? '(shared)').padEnd(12)} ${row.title}`);
    if (stillBlank.length > 40) console.log(`  ... and ${stillBlank.length - 40} more`);
    console.log('');
  }
  const described = new Set(descWrites.map((write) => write.id));
  const stillBare = food.filter((row) => !described.has(row.id) && !row.guestDescription?.trim());
  if (stillBare.length) {
    console.log(`Still without a description (${stillBare.length}) — a guest sees the name and the price:`);
    for (const row of stillBare.slice(0, 40)) console.log(`  ${(row.venue ?? '(shared)').padEnd(12)} ${row.title}`);
    if (stillBare.length > 40) console.log(`  ... and ${stillBare.length - 40} more`);
    console.log('');
  }

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
