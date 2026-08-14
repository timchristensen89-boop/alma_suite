/**
 * Pre-triage of Square menu → recipe mappings (2026-08-14).
 *
 * NEEDS_REVIEW rows carry a proposed recipe and a confidence score, but the
 * score alone can't be trusted — production holds a 0.82-confidence proposal
 * mapping "Taco Special · Chorizo" to the EGGPLANT taco. So auto-confirmation
 * uses the same discriminator that settled the Loaded catalogue: the item and
 * recipe must agree on their measure digits (30mL is 30mL, 250 is 250 —
 * vintages stripped first) AND share their name tokens once serving words
 * (glass/bottle/regular/house) are dropped. Everything else is printed into a
 * review sheet with the best candidate beside it, never touched.
 *
 *   node --import tsx scripts/triage-menu-mappings.ts            # dry run
 *   node --import tsx scripts/triage-menu-mappings.ts --apply
 *
 * Writes the review sheet to /tmp/menu-mapping-review.html either way.
 */
import { writeFileSync } from 'node:fs';
import { prisma } from '@alma/db';

const STOP = new Set([
  'glass', 'bottle', 'regular', 'house', 'the', 'a', 'of', 'ml', 'mls',
  'new', 'special', 'pc', 'pp', 'x'
]);

function tokens(raw: string): { words: Set<string>; digits: string } {
  const cleaned = raw
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, ' ')     // vintages are not measures
    .replace(/\(case of \d+\)/g, ' ')
    .replace(/[''`’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const words = new Set<string>();
  const digits: string[] = [];
  for (const token of cleaned.split(/\s+/)) {
    if (!token) continue;
    if (/^\d+$/.test(token)) {
      digits.push(token);
      continue;
    }
    // "250ml" → digit 250; "1pc" → drop
    const measure = token.match(/^(\d+)(ml|mls|l|g|kg|pc|pp)$/);
    if (measure) {
      if (measure[2] === 'ml' || measure[2] === 'mls' || measure[2] === 'l') digits.push(measure[1]);
      continue;
    }
    if (!STOP.has(token)) words.add(token);
  }
  return { words, digits: digits.sort().join(',') };
}

/** Word-token containment: every word of the smaller set appears in the larger. */
function wordsAgree(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  // A one-word name only matches its exact twin — {salmon} ⊆ "salmon sashimi
  // taco" is not evidence they're the same dish.
  if (small.size < 2 && large.size >= 2) return false;
  let hits = 0;
  for (const word of small) if (large.has(word)) hits += 1;
  // Allow one fuzzy miss for typos (Baltazar/Blatazar) when everything else lands.
  if (hits === small.size) return true;
  if (small.size >= 3 && hits === small.size - 1) {
    const missing = [...small].find((word) => !large.has(word))!;
    return [...large].some((candidate) => oneEditApart(missing, candidate));
  }
  return false;
}

function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

type Row = {
  id: string;
  venue: string | null;
  squareItemName: string;
  squareVariationName: string | null;
  status: string;
  confidence: number | null;
  almaRecipeId: string | null;
};

async function main() {
  const apply = process.argv.includes('--apply');

  const mappings = (await prisma.squareMenuRecipeMapping.findMany({
    where: { status: { in: ['NEEDS_REVIEW', 'UNMAPPED'] } },
    select: {
      id: true, venue: true, squareItemName: true, squareVariationName: true,
      status: true, confidence: true, almaRecipeId: true
    }
  })) as Row[];
  const recipes = await prisma.recipe.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, title: true, venue: true }
  }).catch(async () => prisma.recipe.findMany({ select: { id: true, title: true, venue: true } }));
  const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const recipeTokens = recipes.map((recipe) => ({ recipe, t: tokens(recipe.title) }));

  const confirmed: Array<{ row: Row; recipeTitle: string }> = [];
  const review: Array<{ row: Row; proposal: string; reason: string }> = [];
  const unmapped: Array<{ row: Row; candidates: string }> = [];

  for (const row of mappings) {
    const itemFull = `${row.squareItemName} ${row.squareVariationName ?? ''}`;
    const itemTokens = tokens(itemFull);

    if (row.status === 'NEEDS_REVIEW' && row.almaRecipeId) {
      const recipe = recipeById.get(row.almaRecipeId);
      if (!recipe) {
        review.push({ row, proposal: '(recipe missing)', reason: 'proposed recipe no longer exists' });
        continue;
      }
      const rt = tokens(recipe.title);
      const digitsMatch = itemTokens.digits === rt.digits;
      const nameMatch = wordsAgree(itemTokens.words, rt.words);
      if (digitsMatch && nameMatch) {
        confirmed.push({ row, recipeTitle: recipe.title });
      } else {
        review.push({
          row,
          proposal: recipe.title,
          reason: !nameMatch ? 'names disagree' : `measures disagree (${itemTokens.digits || '—'} vs ${rt.digits || '—'})`
        });
      }
      continue;
    }

    // UNMAPPED (or review with no proposal): rank candidates for the sheet only.
    const scored = recipeTokens
      .filter(({ recipe }) => !recipe.venue || !row.venue || recipe.venue === row.venue)
      .map(({ recipe, t }) => {
        const digitsMatch = itemTokens.digits === t.digits;
        const nameMatch = wordsAgree(itemTokens.words, t.words);
        let overlap = 0;
        for (const word of itemTokens.words) if (t.words.has(word)) overlap += 1;
        return { recipe, score: (nameMatch ? 2 : 0) + (digitsMatch ? 1 : 0) + overlap / Math.max(1, itemTokens.words.size) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .filter(({ score }) => score >= 1);
    const target = row.status === 'UNMAPPED' ? unmapped : review;
    if (target === unmapped) {
      unmapped.push({ row, candidates: scored.map(({ recipe }) => recipe.title).join('  ·  ') || '—' });
    } else {
      review.push({ row, proposal: scored.map(({ recipe }) => recipe.title).join('  ·  ') || '—', reason: 'no proposal stored' });
    }
  }

  console.log(`auto-confirm: ${confirmed.length}  ·  still needs review: ${review.length}  ·  unmapped: ${unmapped.length}`);

  if (apply && confirmed.length) {
    const result = await prisma.squareMenuRecipeMapping.updateMany({
      where: { id: { in: confirmed.map(({ row }) => row.id) } },
      data: { status: 'MAPPED', notes: 'auto-confirmed 2026-08-14: name tokens + measure digits agree', mappedAt: new Date() }
    });
    console.log(`applied: ${result.count} rows → MAPPED`);
  }

  const esc = (value: string | null | undefined) =>
    (value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const rowHtml = (cells: string[]) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
  const html = `<meta charset="utf-8"><title>Menu Mapping Review</title>
<style>
 body{font-family:-apple-system,"Segoe UI",sans-serif;color:#14241a;max-width:860px;margin:32px auto;padding:0 16px}
 h1{font-size:20px;margin:0 0 2px} .sub{color:#5b6660;font-size:13px;margin:0 0 20px}
 h2{font-size:14px;letter-spacing:.06em;text-transform:uppercase;border-bottom:2px solid #14241a;padding-bottom:5px;margin:26px 0 8px}
 table{width:100%;border-collapse:collapse;font-size:13px}
 td,th{padding:6px 8px;border-bottom:1px solid #e4e7e0;text-align:left;vertical-align:top}
 th{font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:#5b6660}
 .why{color:#9a3a2e;font-size:12px}
</style>
<h1>Menu mapping review</h1>
<p class="sub">Generated 14 Aug 2026 · ${confirmed.length} auto-confirmed (listed for audit) · ${review.length} need a human call · ${unmapped.length} unmapped with suggestions. Confirm in Stock → Menu mapping.</p>
<h2>Needs a human call (${review.length})</h2>
<table><tr><th>Square item</th><th>Venue</th><th>Proposed / best candidates</th><th>Why held</th></tr>
${review.map(({ row, proposal, reason }) => rowHtml([
  `${esc(row.squareItemName)}${row.squareVariationName ? ` · ${esc(row.squareVariationName)}` : ''}`,
  esc(row.venue), esc(proposal), `<span class="why">${esc(reason)}</span>`
])).join('\n')}</table>
<h2>Unmapped (${unmapped.length})</h2>
<table><tr><th>Square item</th><th>Venue</th><th>Best candidates</th></tr>
${unmapped.map(({ row, candidates }) => rowHtml([
  `${esc(row.squareItemName)}${row.squareVariationName ? ` · ${esc(row.squareVariationName)}` : ''}`,
  esc(row.venue), esc(candidates)
])).join('\n')}</table>
<h2>Auto-confirmed (${confirmed.length})</h2>
<table><tr><th>Square item</th><th>Venue</th><th>Recipe</th></tr>
${confirmed.map(({ row, recipeTitle }) => rowHtml([
  `${esc(row.squareItemName)}${row.squareVariationName ? ` · ${esc(row.squareVariationName)}` : ''}`,
  esc(row.venue), esc(recipeTitle)
])).join('\n')}</table>`;
  writeFileSync('/tmp/menu-mapping-review.html', html);
  console.log('sheet: /tmp/menu-mapping-review.html');
  if (!apply) console.log('DRY RUN — re-run with --apply to confirm the safe ones.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
