import { readFileSync } from 'node:fs';
import { prisma } from '@alma/db';

// Fill blank recipe categories from a CSV (recipe,category). Only sets the
// category on recipes whose category is currently blank — never overwrites an
// existing one. Matches by recipe title (both per-venue copies get it).
//
// DRY RUN by default — set RECIPE_CAT_CONFIRM=YES to write.
//   RECIPE_CATEGORIES_CSV=docs/recipes-categorized.csv ./scripts/apply-recipe-categories.sh
//   RECIPE_CATEGORIES_CSV=docs/recipes-categorized.csv RECIPE_CAT_CONFIRM=YES ./scripts/apply-recipe-categories.sh

const CONFIRM = process.env.RECIPE_CAT_CONFIRM === 'YES';
const CSV_PATH = process.env.RECIPE_CATEGORIES_CSV || 'docs/recipes-categorized.csv';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '', row: string[] = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}
const norm = (s: string) => s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

async function main() {
  let raw: string;
  try { raw = readFileSync(CSV_PATH, 'utf8'); } catch { console.error(`\n✗ Could not read CSV at "${CSV_PATH}".`); process.exit(1); }
  const rows = parseCsv(raw);
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const iRecipe = header.findIndex((h) => h === 'recipe' || h === 'title');
  const iCat = header.findIndex((h) => h === 'category');
  if (iRecipe === -1 || iCat === -1) { console.error('\n✗ CSV needs columns: recipe, category.'); process.exit(1); }

  const catByTitle = new Map<string, string>();
  for (const r of rows.slice(1)) {
    const t = (r[iRecipe] ?? '').trim(), c = (r[iCat] ?? '').trim();
    if (t && c) catByTitle.set(norm(t), c);
  }

  const recipes = await prisma.recipe.findMany({ select: { id: true, title: true, category: true } });
  const updates: Array<{ id: string; title: string; category: string }> = [];
  let alreadySet = 0, noMatch = 0;
  for (const rec of recipes) {
    if (rec.category && rec.category.trim()) { alreadySet++; continue; }
    const cat = catByTitle.get(norm(rec.title));
    if (!cat) { noMatch++; continue; }
    updates.push({ id: rec.id, title: rec.title, category: cat });
  }

  console.log(`\nCSV: ${CSV_PATH} · ${catByTitle.size} recipe titles`);
  console.log(`Recipes: ${recipes.length} · blank-to-fill ${updates.length} · already-categorised ${alreadySet} · still-blank-no-match ${noMatch}`);
  const counts = new Map<string, number>();
  for (const u of updates) counts.set(u.category, (counts.get(u.category) ?? 0) + 1);
  console.log('\nby category:');
  for (const [c, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${c}`);

  if (!CONFIRM) {
    console.log(`\nDRY RUN — nothing changed. To apply: RECIPE_CATEGORIES_CSV=${CSV_PATH} RECIPE_CAT_CONFIRM=YES ./scripts/apply-recipe-categories.sh`);
    await prisma.$disconnect();
    return;
  }
  let n = 0;
  for (const u of updates) { await prisma.recipe.update({ where: { id: u.id }, data: { category: u.category } }); n++; }
  console.log(`\n✅ Filled category on ${n} recipes.`);
  await prisma.$disconnect();
}
main().catch((err) => { console.error(err); process.exit(1); });
