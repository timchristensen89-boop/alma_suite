/**
 * Taco Tuesday, wired end to end — and the register gaps that stood in its
 * way, closed.
 *
 * What Tim asked for, in order:
 *
 *   BATTERED / GRILLED AS OPTIONS. The register sold the fish taco as two
 *   dishes; the print sells one "Barramundi taco". The two recipes STAY (the
 *   kitchen batters one and grills the other, and the docket must say which)
 *   but they fold under one tile as variants, exactly the way a wine's pours
 *   already do. Tapping the tile asks the one question the print implies.
 *
 *   TACO TUESDAY, AUTOMATICALLY. Every St Alma taco takes a $5 window on
 *   weekday 2 (PosPriceWindow), and the register, the QR menu and the QR
 *   reprice all apply it themselves. Nobody re-keys a price on Tuesday
 *   morning again.
 *
 *   THE TUESDAY BOARD. "Try them all — 20" exists only on the Tuesday print,
 *   so its window is marked onlyWindow: the register offers it on Tuesdays
 *   and it does not exist on any other day.
 *
 *   AGAVE PAIRING. Both venues' prints carry it at 45 pp beside Grazing and
 *   Feasting; the register had no tile for it. A set menu with no courses is
 *   just a priced per-person tile, which is exactly what a pairing flight is.
 *
 * St Alma's register had NO tacos at all — the pair above is tagged to Alma
 * Avalon, and the rest were never entered — so this also creates St Alma's
 * four tacos from docs/menu-dietary.tsv: the print's price, marks and copy,
 * nothing invented. They are sellable dishes with no kitchen build yet;
 * costing follows when the kitchen enters their recipes in Stock.
 *
 * Report first, like every script here. Nothing is written without --apply,
 * a near-miss is reported rather than guessed at, and a dish somebody
 * already entered is left alone.
 *
 *   node --import tsx scripts/wire-taco-tuesday.ts
 *   node --import tsx scripts/wire-taco-tuesday.ts --apply
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '@alma/db';
import { dishTokens, matchDish } from '../src/lib/dish-dietary.js';

const apply = process.argv.includes('--apply');
const TUESDAY = '2'; // JS weekday csv, same shape as PosRule.weekdays.
const LABEL = 'Taco Tuesday';

type MenuRow = { venue: string; section: string; dish: string; price: string; description: string; apply: string };

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
      apply: at(cells, 'apply')
    };
  });
}

/** "chorizo and potato taco" → "Chorizo and Potato Taco" — register style. */
function titleCase(dish: string): string {
  const small = new Set(['and', 'of', 'the', 'with']);
  return dish
    .split(/\s+/)
    .map((word, index) =>
      index > 0 && small.has(word.toLowerCase()) ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(' ');
}

const planned: string[] = [];
const report = (line: string) => {
  planned.push(line);
  console.log(line);
};

async function upsertWindow(recipeId: string, title: string, priceCents: number, onlyWindow: boolean) {
  const existing = await prisma.posPriceWindow.findFirst({ where: { recipeId, label: LABEL } });
  if (existing) {
    if (existing.priceCents === priceCents && existing.weekdays === TUESDAY && existing.onlyWindow === onlyWindow && existing.active) {
      report(`  = ${title} — Tuesday window already in place ($${(priceCents / 100).toFixed(2)})`);
      return;
    }
    report(`  ~ ${title} — Tuesday window corrected to $${(priceCents / 100).toFixed(2)}${onlyWindow ? ', Tuesday-only' : ''}`);
    if (apply) {
      await prisma.posPriceWindow.update({
        where: { id: existing.id },
        data: { priceCents, weekdays: TUESDAY, onlyWindow, active: true }
      });
    }
    return;
  }
  report(`  + ${title} — $${(priceCents / 100).toFixed(2)} every Tuesday${onlyWindow ? ', and offered ONLY on Tuesdays' : ''}`);
  if (apply) {
    await prisma.posPriceWindow.create({ data: { recipeId, label: LABEL, weekdays: TUESDAY, priceCents, onlyWindow } });
  }
}

async function upsertVariantLink(parentRecipeId: string, childRecipeId: string, label: string, sortOrder: number) {
  await prisma.posVariantLink.upsert({
    where: { childRecipeId },
    create: { parentRecipeId, childRecipeId, label, sortOrder },
    update: { parentRecipeId, label, sortOrder }
  });
}

async function main() {
  const venues = new Set(
    (await prisma.recipe.findMany({ where: { venue: { not: null } }, select: { venue: true }, distinct: ['venue'] })).map(
      (row) => row.venue!
    )
  );
  const stAlma = [...venues].find((name) => /st\.?\s*alma/i.test(name));
  const avalon = [...venues].find((name) => /avalon/i.test(name));
  if (!stAlma || !avalon) {
    console.log(`Could not resolve both venues from the register (found: ${[...venues].join(', ') || 'none'}). Nothing to do safely.`);
    return;
  }
  console.log(`Venues: ${stAlma} · ${avalon}${apply ? '' : '   (dry run)'}\n`);

  const active = await prisma.recipe.findMany({
    where: { status: 'ACTIVE', isPrepRecipe: false },
    select: { id: true, title: true, printTitle: true, venue: true, kind: true, category: true, salePriceCents: true, guestDescription: true, dietary: true }
  });
  // Folding is not a one-way door for THIS script: on a re-run the children
  // must neither compete for a menu match (the seeder skips them for the
  // same reason) nor read as a second barramundi to fold.
  const links = await prisma.posVariantLink.findMany();
  const childIds = new Set(links.filter((link) => link.childRecipeId !== link.parentRecipeId).map((link) => link.childRecipeId));
  const parentIds = new Set(links.map((link) => link.parentRecipeId));

  // ── 1 · Fold Avalon's pair under one tile ─────────────────────────────
  console.log(`FISH TACO — Battered / Grilled as options (${avalon})`);
  const avalonPool = active.filter((row) => row.venue === avalon);
  const withTokens = (pool: typeof active, wanted: string[]) =>
    pool.filter((row) => {
      const tokens = new Set(dishTokens(row.title));
      return wanted.every((token) => tokens.has(token));
    });
  const alreadyFolded = withTokens(avalonPool, ['barramundi']).filter((row) => parentIds.has(row.id));
  const battered = withTokens(avalonPool, ['battered', 'barramundi']).filter((row) => !childIds.has(row.id));
  const grilled = withTokens(avalonPool, ['grilled', 'barramundi']).filter((row) => !childIds.has(row.id));
  if (alreadyFolded.length > 0) {
    report(`  = already folded under "${alreadyFolded[0]!.title}" — left alone`);
  } else if (battered.length !== 1 || grilled.length !== 1) {
    report(
      `  ? expected exactly one battered and one grilled barramundi at ${avalon}, found ` +
        `${battered.length} battered (${battered.map((row) => row.title).join(', ') || 'none'}) and ` +
        `${grilled.length} grilled (${grilled.map((row) => row.title).join(', ') || 'none'}) — folding skipped for a human to look at`
    );
  } else {
    // The print sells the taco GF, which is the grilled preparation — so the
    // grilled recipe becomes the tile ("Barramundi Taco", the print's name)
    // and keeps its old name as the docket title. The battered recipe is
    // untouched: its full title IS its docket line.
    const parent = grilled[0]!;
    const child = battered[0]!;
    report(`  + tile: "${parent.title}" → "Barramundi Taco" (docket stays "${parent.printTitle ?? parent.title}")`);
    report(`  + options on the tile: Grilled (the print's default) · Battered`);
    if (apply) {
      await prisma.recipe.update({
        where: { id: parent.id },
        data: { title: 'Barramundi Taco', printTitle: parent.printTitle ?? parent.title }
      });
      await upsertVariantLink(parent.id, parent.id, 'Grilled', 0);
      await upsertVariantLink(parent.id, child.id, 'Battered', 1);
    }
  }

  // ── 2 · St Alma's tacos, from the print ───────────────────────────────
  console.log(`\nST ALMA TACOS — created from docs/menu-dietary.tsv where missing`);
  const menuRows = readMenu().filter((row) => row.venue === 'St Alma' && row.section === 'Tacos');
  const stAlmaPool = active.filter((row) => row.venue === stAlma && !childIds.has(row.id));
  const stAlmaTitles = stAlmaPool.map((row) => row.title);
  const tuesdayTacos: Array<{ id: string; title: string }> = [];
  const boardRow = menuRows.find((row) => /try them all/i.test(row.dish));
  for (const row of menuRows) {
    if (row === boardRow) continue;
    const match = matchDish(row.dish, stAlmaTitles);
    if (match.kind === 'matched') {
      const found = stAlmaPool.find((candidate) => candidate.title === match.registerTitle)!;
      report(`  = ${row.dish} — already in the register as "${found.title}", left alone`);
      tuesdayTacos.push({ id: found.id, title: found.title });
      // Its folded options ring at $5 on Tuesday too — a grilled barramundi
      // is not full price because it went through the sheet.
      for (const link of links.filter((entry) => entry.parentRecipeId === found.id && entry.childRecipeId !== found.id)) {
        const option = active.find((candidate) => candidate.id === link.childRecipeId);
        if (option) tuesdayTacos.push({ id: option.id, title: option.title });
      }
      continue;
    }
    if (match.kind === 'ambiguous') {
      report(`  ? ${row.dish} — more than one candidate (${match.candidates.map((c) => c.registerTitle).join(', ')}); skipped for a human`);
      continue;
    }
    const isBarramundi = /barramundi/i.test(row.dish);
    const title = isBarramundi ? 'Barramundi Taco' : titleCase(row.dish);
    const dietary = row.apply
      ? row.apply.split(',').map((tag) => tag.trim()).filter(Boolean)
      : [];
    report(`  + ${title} — $${row.price}, ${dietary.length ? dietary.join(' ') : 'unmarked'}, "${row.description}"`);
    if (isBarramundi) {
      // The print sells it GFA — battered is the default and grilled is the
      // gluten-free answer — so the parent IS the battered preparation, named
      // for the tile, with the docket saying which. The grilled twin is a
      // second recipe folded on as an option; its dietary stays UNCHECKED on
      // purpose — deriving "grilled = gluten free" would be inventing a
      // claim the print never made about that preparation.
      report(`      with options: Battered (the print's default) · Grilled`);
    }
    if (!apply) {
      tuesdayTacos.push({ id: `(new) ${title}`, title });
      // The grilled twin gets its own $5 window on --apply; the dry run has
      // to say so, or the report promises less than the apply writes.
      if (isBarramundi) tuesdayTacos.push({ id: '(new) Grilled Barramundi Taco', title: 'Grilled Barramundi Taco' });
      continue;
    }
    const created = await prisma.recipe.create({
      data: {
        title,
        venue: stAlma,
        category: 'Tacos',
        status: 'ACTIVE',
        isPrepRecipe: false,
        salePriceCents: Math.round(Number(row.price) * 100),
        guestDescription: row.description || null,
        dietary,
        ...(isBarramundi ? { printTitle: 'Battered Barramundi Taco' } : {})
      }
    });
    tuesdayTacos.push({ id: created.id, title: created.title });
    if (isBarramundi) {
      const twin = await prisma.recipe.create({
        data: {
          title: 'Grilled Barramundi Taco',
          venue: stAlma,
          category: 'Tacos',
          status: 'ACTIVE',
          isPrepRecipe: false,
          salePriceCents: Math.round(Number(row.price) * 100),
          dietary: []
        }
      });
      await upsertVariantLink(created.id, created.id, 'Battered', 0);
      await upsertVariantLink(created.id, twin.id, 'Grilled', 1);
      tuesdayTacos.push({ id: twin.id, title: twin.title });
    }
  }

  // ── 3 · $5 Tuesday windows on every St Alma taco ──────────────────────
  console.log(`\nTACO TUESDAY — $5 windows (weekday 2, applied by the register itself)`);
  if (!apply && tuesdayTacos.some((taco) => taco.id.startsWith('(new)'))) {
    report(`  (windows for dishes created above are listed as they will be written on --apply)`);
  }
  for (const taco of tuesdayTacos) {
    if (taco.id.startsWith('(new)')) {
      report(`  + ${taco.title} — $5.00 every Tuesday`);
      continue;
    }
    await upsertWindow(taco.id, taco.title, 500, false);
  }

  // ── 4 · The Tuesday-only board ────────────────────────────────────────
  console.log(`\nTRY THEM ALL — the $20 Tuesday board`);
  if (!boardRow) {
    report('  ? docs/menu-dietary.tsv has no "Try them all" row for St Alma — nothing to build it from');
  } else {
    const match = matchDish(boardRow.dish, stAlmaTitles);
    if (match.kind === 'matched') {
      const found = stAlmaPool.find((candidate) => candidate.title === match.registerTitle)!;
      report(`  = already in the register as "${found.title}"`);
      await upsertWindow(found.id, found.title, 2000, true);
    } else {
      report(`  + Try Them All Taco Board — $20, one of each taco, offered ONLY on Tuesdays`);
      report(`      costed as one of each of the four tacos above`);
      if (apply) {
        const realTacos = tuesdayTacos.filter((taco) => !taco.id.startsWith('(new)'));
        const board = await prisma.recipe.create({
          data: {
            title: 'Try Them All Taco Board',
            venue: stAlma,
            category: 'Tacos',
            status: 'ACTIVE',
            isPrepRecipe: false,
            salePriceCents: 2000,
            guestDescription: boardRow.description || null,
            dietary: [],
            lines: {
              create: realTacos
                // One of each TILE: the barramundi on the board is whichever
                // way the guest asks for it; the battered parent stands in
                // for costing.
                .filter((taco) => taco.title !== 'Grilled Barramundi Taco')
                .map((taco, index) => ({
                  position: index + 1,
                  ingredientName: taco.title,
                  quantity: 1,
                  unit: 'serve',
                  subRecipeId: taco.id
                }))
            }
          }
        });
        await upsertWindow(board.id, board.title, 2000, true);
      }
    }
  }

  // ── 5 · Agave Pairing, beside Grazing and Feasting ────────────────────
  console.log(`\nAGAVE PAIRING — 45 pp, both prints, shared like the other set menus`);
  const setMenus = await prisma.recipe.findMany({
    where: { kind: 'SET_MENU', status: 'ACTIVE' },
    select: { id: true, title: true, salePriceCents: true }
  });
  const agave = setMenus.filter((row) => /agave/i.test(row.title));
  if (agave.length > 0) {
    report(`  = already in the register: ${agave.map((row) => `"${row.title}"`).join(', ')} — left alone`);
  } else {
    report(`  + Agave Pairing Set Menu — $45 pp, no courses (a priced per-person tile, like a flight is)`);
    if (apply) {
      await prisma.recipe.create({
        data: {
          title: 'Agave Pairing Set Menu',
          kind: 'SET_MENU',
          status: 'ACTIVE',
          isPrepRecipe: false,
          salePriceCents: 4500,
          guestDescription: 'A flight or matched pours.',
          dietary: []
        }
      });
    }
  }

  console.log(
    apply
      ? '\nApplied. The register, QR menu and QR ordering all price Tuesdays themselves from here.'
      : '\nDry run. Nothing written. Re-run with --apply to make it so.'
  );
  if (apply) {
    console.log('Kitchen still owed: recipe builds in Stock for any dish created above (they sell fine meanwhile, uncosted).');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
