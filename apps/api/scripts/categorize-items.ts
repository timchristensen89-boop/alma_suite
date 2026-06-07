import { readFileSync } from 'node:fs';
import { prisma } from '@alma/db';

// Bulk-apply stock item categories from a CSV in one shot.
//
// Input CSV needs a category column plus something to match the item on — a
// `sku` column (preferred, exact match) and/or a name column (`item`/`name`/
// `product`). The raw Stocktake export works as-is once you've filled in the
// `category` column. Header row required; column order doesn't matter.
//
//   sku,item,category
//   ,Pol Roger Brut NV,Wine — Sparkling
//   ,Maldon Sea Salt,Dry / Pantry
//
// DRY RUN by default (prints exactly what it would do). Set
// CATEGORIZE_CONFIRM=YES to write. Missing categories are created.
//
//   CATEGORIES_CSV=docs/items-categorized.csv ./scripts/categorize-items.sh
//   CATEGORIES_CSV=docs/items-categorized.csv CATEGORIZE_CONFIRM=YES ./scripts/categorize-items.sh

const CONFIRM = process.env.CATEGORIZE_CONFIRM === 'YES';
const CSV_PATH = process.env.CATEGORIES_CSV || 'docs/items-categorized.csv';

// Minimal RFC4180-ish parser — handles quoted fields, embedded commas, CRLF.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

const norm = (s: string) => s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

async function main() {
  let raw: string;
  try {
    raw = readFileSync(CSV_PATH, 'utf8');
  } catch {
    console.error(`\n✗ Could not read CSV at "${CSV_PATH}".`);
    console.error(`  Set CATEGORIES_CSV to the file path, e.g.`);
    console.error(`     CATEGORIES_CSV=docs/items-categorized.csv ./scripts/categorize-items.sh`);
    process.exit(1);
  }

  const rows = parseCsv(raw);
  if (rows.length < 2) {
    console.error('\n✗ CSV has no data rows.');
    process.exit(1);
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idxCategory = header.findIndex((h) => h === 'category');
  const idxSku = header.findIndex((h) => h === 'sku');
  const idxName = header.findIndex((h) => h === 'item' || h === 'name' || h === 'product');
  if (idxCategory === -1 || (idxSku === -1 && idxName === -1)) {
    console.error('\n✗ CSV needs a "category" column and at least one of "sku" / "item" / "name".');
    console.error(`  Found headers: ${header.join(', ')}`);
    process.exit(1);
  }

  // Pull the whole catalogue once and index by sku + normalised name.
  const items = await prisma.stockItem.findMany({
    select: { id: true, name: true, sku: true, categoryId: true, category: { select: { name: true } } }
  });
  const bySku = new Map<string, typeof items[number]>();
  const byName = new Map<string, typeof items>();
  for (const it of items) {
    if (it.sku) bySku.set(norm(it.sku), it);
    const k = norm(it.name);
    const list = byName.get(k) ?? [];
    list.push(it);
    byName.set(k, list);
  }

  const categories = await prisma.stockCategory.findMany({ select: { id: true, name: true } });
  const catByName = new Map(categories.map((c) => [norm(c.name), c]));

  type Plan = { item: typeof items[number]; from: string; to: string; categoryName: string };
  const updates: Plan[] = [];
  const unmatched: Array<{ key: string; category: string }> = [];
  const ambiguous: Array<{ name: string; category: string; count: number }> = [];
  const newCategories = new Set<string>();
  let alreadyCorrect = 0;
  let blankCategory = 0;

  for (const r of rows.slice(1)) {
    const targetCategory = (r[idxCategory] ?? '').trim();
    const sku = idxSku >= 0 ? (r[idxSku] ?? '').trim() : '';
    const name = idxName >= 0 ? (r[idxName] ?? '').trim() : '';
    const label = sku || name;
    if (!targetCategory) { blankCategory++; continue; }

    // Match: sku first (exact), then unambiguous normalised name.
    let item: typeof items[number] | undefined;
    if (sku) item = bySku.get(norm(sku));
    if (!item && name) {
      const list = byName.get(norm(name)) ?? [];
      if (list.length === 1) item = list[0];
      else if (list.length > 1) { ambiguous.push({ name, category: targetCategory, count: list.length }); continue; }
    }
    if (!item) { unmatched.push({ key: label, category: targetCategory }); continue; }

    if (!catByName.has(norm(targetCategory))) newCategories.add(targetCategory);

    if (item.category?.name && norm(item.category.name) === norm(targetCategory)) {
      alreadyCorrect++;
      continue;
    }
    updates.push({ item, from: item.category?.name ?? '(uncategorised)', to: targetCategory, categoryName: targetCategory });
  }

  // ---- Report ----
  console.log(`\nCSV: ${CSV_PATH}`);
  console.log(`Catalogue: ${items.length} stock items · ${categories.length} existing categories`);
  console.log(`\nRows: ${rows.length - 1} · matched-to-change ${updates.length} · already-correct ${alreadyCorrect} · blank-category ${blankCategory} · unmatched ${unmatched.length} · ambiguous ${ambiguous.length}`);

  if (newCategories.size > 0) {
    console.log(`\nNew categories to create (${newCategories.size}):`);
    for (const c of [...newCategories].sort()) console.log(`   + ${c}`);
  }

  const perCategory = new Map<string, number>();
  for (const u of updates) perCategory.set(u.to, (perCategory.get(u.to) ?? 0) + 1);
  if (perCategory.size > 0) {
    console.log(`\nChanges by category:`);
    for (const [c, n] of [...perCategory.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`   ${String(n).padStart(4)}  ${c}`);
    }
  }

  if (ambiguous.length > 0) {
    console.log(`\n⚠ Ambiguous names (multiple items share the name — add a sku to disambiguate):`);
    for (const a of ambiguous.slice(0, 40)) console.log(`   ${a.name}  → ${a.category}  (${a.count} items)`);
    if (ambiguous.length > 40) console.log(`   …and ${ambiguous.length - 40} more`);
  }

  if (unmatched.length > 0) {
    console.log(`\n⚠ Unmatched rows (no item with that sku/name — check spelling):`);
    for (const u of unmatched.slice(0, 40)) console.log(`   ${u.key}  → ${u.category}`);
    if (unmatched.length > 40) console.log(`   …and ${unmatched.length - 40} more`);
  }

  if (!CONFIRM) {
    console.log(`\nDRY RUN — nothing changed. To apply, re-run with:`);
    console.log(`   CATEGORIES_CSV=${CSV_PATH} CATEGORIZE_CONFIRM=YES ./scripts/categorize-items.sh`);
    await prisma.$disconnect();
    return;
  }

  // ---- Apply ----
  // 1) Create any missing categories.
  for (const name of newCategories) {
    const created = await prisma.stockCategory.create({ data: { name } });
    catByName.set(norm(name), { id: created.id, name: created.name });
  }
  // 2) Group item ids by target category and updateMany.
  const idsByCategory = new Map<string, string[]>();
  for (const u of updates) {
    const cat = catByName.get(norm(u.categoryName));
    if (!cat) continue;
    const list = idsByCategory.get(cat.id) ?? [];
    list.push(u.item.id);
    idsByCategory.set(cat.id, list);
  }
  let updated = 0;
  for (const [categoryId, ids] of idsByCategory) {
    const res = await prisma.stockItem.updateMany({ where: { id: { in: ids } }, data: { categoryId } });
    updated += res.count;
  }

  console.log(`\n✅ Created ${newCategories.size} categories · re-categorised ${updated} items.`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
