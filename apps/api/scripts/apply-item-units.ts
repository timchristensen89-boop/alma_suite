import { readFileSync } from 'node:fs';
import { prisma } from '@alma/db';

// Apply purchase/count units + conversion factors to stock items from a CSV
// (built from the categorised list). Fixes the "wine counted in mL" cost bug by
// flipping wines (and most things) onto whole purchase units, with case packs
// dividing the cost down to a per-bottle/each figure.
//
// CSV columns: item, sku, unit, count_unit, conversion_factor (+ extras ignored)
//   - unit              = purchase unit (case / bottle / each / kg / L)
//   - count_unit        = how it's counted in stocktake (bottle / each / kg / L)
//   - conversion_factor = count units per purchase unit (cost ÷ factor = per-count-unit cost)
//
// DRY RUN by default — set UNITS_CONFIRM=YES to write.
//   ITEM_UNITS_CSV=docs/items-units.csv ./scripts/apply-item-units.sh
//   ITEM_UNITS_CSV=docs/items-units.csv UNITS_CONFIRM=YES ./scripts/apply-item-units.sh

const CONFIRM = process.env.UNITS_CONFIRM === 'YES';
const CSV_PATH = process.env.ITEM_UNITS_CSV || 'docs/items-units.csv';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '', row: string[] = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

const norm = (s: string) => s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const money = (c: number | null | undefined) => (c == null ? '—' : '$' + (c / 100).toFixed(2));

async function main() {
  let raw: string;
  try { raw = readFileSync(CSV_PATH, 'utf8'); }
  catch { console.error(`\n✗ Could not read CSV at "${CSV_PATH}".`); process.exit(1); }

  const rows = parseCsv(raw);
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const iItem = header.findIndex((h) => h === 'item' || h === 'name');
  const iSku = header.findIndex((h) => h === 'sku');
  const iUnit = header.findIndex((h) => h === 'unit');
  const iCount = header.findIndex((h) => h === 'count_unit');
  const iConv = header.findIndex((h) => h === 'conversion_factor');
  if (iItem === -1 || iUnit === -1 || iCount === -1 || iConv === -1) {
    console.error('\n✗ CSV needs columns: item, unit, count_unit, conversion_factor.');
    process.exit(1);
  }

  const items = await prisma.stockItem.findMany({
    select: { id: true, name: true, sku: true, unit: true, countUnit: true, conversionFactor: true, latestCostCents: true, avgCostCents: true }
  });
  const bySku = new Map<string, typeof items[number]>();
  const byName = new Map<string, typeof items>();
  for (const it of items) {
    if (it.sku) bySku.set(norm(it.sku), it);
    const k = norm(it.name);
    const list = byName.get(k) ?? []; list.push(it); byName.set(k, list);
  }

  type Plan = { item: typeof items[number]; unit: string; countUnit: string; conv: number };
  const updates: Plan[] = [];
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  let unchanged = 0;

  for (const r of rows.slice(1)) {
    const itemName = (r[iItem] ?? '').trim();
    const sku = iSku >= 0 ? (r[iSku] ?? '').trim() : '';
    const unit = (r[iUnit] ?? '').trim();
    const countUnit = (r[iCount] ?? '').trim();
    const conv = Number(r[iConv]) || 1;
    if (!itemName || !unit || !countUnit) continue;

    let item: typeof items[number] | undefined;
    if (sku) item = bySku.get(norm(sku));
    if (!item) {
      const list = byName.get(norm(itemName)) ?? [];
      if (list.length === 1) item = list[0];
      else if (list.length > 1) { ambiguous.push(itemName); continue; }
    }
    if (!item) { unmatched.push(itemName); continue; }

    if (item.unit === unit && (item.countUnit ?? '') === countUnit && Number(item.conversionFactor) === conv) {
      unchanged++; continue;
    }
    updates.push({ item, unit, countUnit, conv });
  }

  console.log(`\nCSV: ${CSV_PATH}`);
  console.log(`Catalogue: ${items.length} items · to change ${updates.length} · already-correct ${unchanged} · unmatched ${unmatched.length} · ambiguous ${ambiguous.length}`);

  // Show the wine/case re-cost (the financial fix) so it can be eyeballed.
  const wineish = updates.filter((u) => u.conv > 1).slice(0, 25);
  if (wineish.length) {
    console.log(`\nCase items re-costed to per-${'unit'} (cost ÷ pack):`);
    for (const u of wineish) {
      const cost = u.item.latestCostCents ?? u.item.avgCostCents;
      const per = cost != null ? Math.round(cost / u.conv) : null;
      console.log(`   ${u.item.unit}/${u.item.countUnit ?? '-'} → ${u.unit}/${u.countUnit} ÷${u.conv}   ${money(cost)} → ${money(per)}/${u.countUnit}   ${u.item.name.slice(0, 44)}`);
    }
  }
  if (ambiguous.length) {
    console.log(`\n⚠ Ambiguous (duplicate names — merge first or add sku): ${ambiguous.length}`);
    ambiguous.slice(0, 15).forEach((a) => console.log('   ' + a.slice(0, 60)));
  }
  if (unmatched.length) {
    console.log(`\n⚠ Unmatched: ${unmatched.length}`);
    unmatched.slice(0, 15).forEach((a) => console.log('   ' + a.slice(0, 60)));
  }

  if (!CONFIRM) {
    console.log(`\nDRY RUN — nothing changed. To apply:`);
    console.log(`   ITEM_UNITS_CSV=${CSV_PATH} UNITS_CONFIRM=YES ./scripts/apply-item-units.sh`);
    await prisma.$disconnect();
    return;
  }

  let n = 0;
  for (const u of updates) {
    await prisma.stockItem.update({
      where: { id: u.item.id },
      data: { unit: u.unit, countUnit: u.countUnit, conversionFactor: u.conv }
    });
    n++;
  }
  console.log(`\n✅ Updated units on ${n} items. Stocktake values now reflect whole purchase units.`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
