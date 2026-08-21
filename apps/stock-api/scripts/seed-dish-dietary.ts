/**
 * Put the printed menus' dietary marks onto the register's dishes.
 *
 * Every dietary chip in the POS filter currently reads 0, because nothing has
 * ever been marked — and the register is careful about that: an unmarked dish
 * is "nobody has checked", never "safe". So the filter is honest but useless,
 * and a server answering "is this gluten free?" is back to asking the kitchen.
 *
 * The source is docs/menu-dietary.tsv, transcribed from the three current
 * prints. Nothing here reads a dish's NAME and decides what is in it.
 *
 * Three rules, because this is allergen data:
 *
 *   1. Venue-scoped, always. The same dish name is different food at the two
 *      venues — St Alma's guacamole is salsa macha and carries a nut mark,
 *      Avalon's is wakame and does not.
 *   2. A near miss is reported, never applied. Ambiguity comes back for a
 *      human; there is no best-guess branch.
 *   3. A dish that already carries tags DIFFERENT from the menu's is left
 *      alone and reported. Filling in a blank is bookkeeping; overruling
 *      somebody who marked a dish by hand is a decision, and this script
 *      cannot make it. --overwrite if you mean it.
 *
 *   node --import tsx scripts/seed-dish-dietary.ts
 *   node --import tsx scripts/seed-dish-dietary.ts --apply
 *   node --import tsx scripts/seed-dish-dietary.ts --apply --overwrite
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
    select: { id: true, title: true, venue: true, category: true, dietary: true }
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

  const writes: Array<{ id: string; title: string; venue: string; tags: string[] }> = [];
  const alreadyRight: string[] = [];
  const disagree: string[] = [];
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
    const current = parseDishDietary(item.dietary);

    if (same(current, wanted)) {
      alreadyRight.push(`  ${row.venue} · ${item.title}  ${show(wanted)}`);
      continue;
    }
    if (current.length && !overwrite) {
      disagree.push(`  ${row.venue} · ${item.title}: register ${show(current)} vs menu ${show(wanted)}`);
      continue;
    }
    writes.push({ id: item.id, title: item.title, venue: row.venue, tags: wanted });
  }

  if (flagged.length) {
    console.log(`Read the menu, then read these (${flagged.length}) — every one is a question for the kitchen:`);
    for (const line of flagged) console.log(line);
    console.log('');
  }
  if (writes.length) {
    console.log(`${writes.length} dish(es) to mark:`);
    for (const write of writes) console.log(`  ${write.venue.padEnd(12)} ${write.title.padEnd(42)} ${show(write.tags)}`);
    console.log('');
  }
  if (alreadyRight.length) console.log(`Already correct (${alreadyRight.length})\n`);
  if (disagree.length) {
    console.log(`Already marked, and the register disagrees with the menu — LEFT ALONE (${disagree.length}):`);
    for (const line of disagree) console.log(line);
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
  // can order tonight that still carries no marks at all.
  const marked = new Set(writes.map((write) => write.id));
  const stillBlank = food.filter((row) => !marked.has(row.id) && parseDishDietary(row.dietary).length === 0);
  if (stillBlank.length) {
    console.log(`Still unmarked after this run (${stillBlank.length}) — the filter reads these as "nobody has checked":`);
    for (const row of stillBlank.slice(0, 40)) console.log(`  ${(row.venue ?? '(shared)').padEnd(12)} ${row.title}`);
    if (stillBlank.length > 40) console.log(`  ... and ${stillBlank.length - 40} more`);
    console.log('');
  }

  if (!apply) {
    console.log('Dry run. Nothing written. Re-run with --apply to mark the dishes above.');
    await prisma.$disconnect();
    return;
  }

  for (const write of writes) {
    await prisma.recipe.update({ where: { id: write.id }, data: { dietary: write.tags } });
  }
  console.log(`Marked ${writes.length} dish(es).`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
