import { readFileSync, writeFileSync } from 'node:fs';
import { prisma } from '@alma/db';

// Find the stock items that BREAK recipe costing because a recipe line is in a
// weight/volume unit (g, kg, ml, l) but the item is costed per a COUNT unit
// (punnet, bunch, each, box…) with no measure-per-count-unit set. For each, it
// proposes a sensible "how much one count unit holds" (e.g. 1 punnet ≈ 250 g)
// so the g/mL lines can be costed.
//
// DETECT (default): print the worklist + write a reviewable CSV (item, sku,
//   count_unit, measure_per_count_unit, measure_unit). Edit the numbers, then:
// APPLY (MEASURE_CONFIRM=YES): read the CSV back and set the measures.
//
//   ./scripts/suggest-item-measures.sh                      # detect → writes docs/item-measures.csv
//   MEASURE_CONFIRM=YES ./scripts/suggest-item-measures.sh  # apply the (reviewed) CSV
//
// Every suggested number is an ESTIMATE — review the CSV before applying.

const CONFIRM = process.env.MEASURE_CONFIRM === 'YES';
const CSV_PATH = process.env.MEASURES_CSV || 'docs/item-measures.csv';

const METRIC = new Set(['g', 'gm', 'gram', 'grams', 'kg', 'kilo', 'mg', 'ml', 'millilitre', 'milliliter', 'l', 'lt', 'litre', 'liter', 'cl', 'dl']);
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const isMetric = (u: string | null | undefined) => METRIC.has(norm(u));

// Rough starting measures (g unless noted). Review before applying.
function suggestMeasure(name: string, costUnit: string): { value: number; unit: 'g' | 'ml' } {
  const n = name.toLowerCase();
  const cu = costUnit.toLowerCase();
  const liquid = /juice|oil|vinegar|syrup|milk|cream|stock|sauce|puree|water|wine|spirit|liqueur|tonic|soda|nectar/.test(n);
  const u: 'g' | 'ml' = liquid ? 'ml' : 'g';
  // product-specific
  if (/(coriander|parsley|mint|basil|dill|tarragon|chive|thyme|rosemary|oregano|sage)/.test(n) && /bunch/.test(cu)) return { value: 30, unit: 'g' };
  if (/radish/.test(n) && /bunch/.test(cu)) return { value: 150, unit: 'g' };
  if (/(shallot|spring onion|scallion)/.test(n) && /bunch/.test(cu)) return { value: 100, unit: 'g' };
  if (/(lime|lemon)/.test(n) && /(each|ea)\b/.test(cu)) return { value: 70, unit: 'g' };
  if (/avocado/.test(n) && /(each|ea)\b/.test(cu)) return { value: 200, unit: 'g' };
  if (/(cucumber|tomato|capsicum|pepper)/.test(n) && /punnet/.test(cu)) return { value: 250, unit: 'g' };
  if (/(lettuce|cabbage|iceberg)/.test(n) && /(each|ea|head)\b/.test(cu)) return { value: 400, unit: 'g' };
  // generic by count unit
  const base: Record<string, number> = {
    punnet: 200, bunch: 120, box: 2000, tray: 1000, bag: 1000, head: 400,
    each: 100, ea: 100, clove: 5, sprig: 3, leaf: 1, sheet: 5, packet: 250, pack: 250, tub: 500, jar: 250, can: 400, tin: 400
  };
  for (const k of Object.keys(base)) if (cu.includes(k)) return { value: base[k]!, unit: u };
  return { value: 100, unit: u };
}

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
const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

async function applyFromCsv() {
  let raw: string;
  try { raw = readFileSync(CSV_PATH, 'utf8'); } catch { console.error(`\n✗ Could not read CSV at "${CSV_PATH}". Run the detect pass first.`); process.exit(1); }
  const rows = parseCsv(raw);
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const iName = header.findIndex((h) => h === 'item' || h === 'name');
  const iSku = header.findIndex((h) => h === 'sku');
  const iVal = header.findIndex((h) => h === 'measure_per_count_unit' || h === 'measure');
  const iUnit = header.findIndex((h) => h === 'measure_unit' || h === 'unit');
  if (iName === -1 || iVal === -1) { console.error('\n✗ CSV needs columns: item, measure_per_count_unit[, measure_unit, sku].'); process.exit(1); }

  let applied = 0, skipped = 0, unmatched = 0;
  for (const r of rows.slice(1)) {
    const name = (r[iName] ?? '').trim();
    const sku = iSku >= 0 ? (r[iSku] ?? '').trim() : '';
    const value = Number((r[iVal] ?? '').trim());
    const unit = iUnit >= 0 ? norm(r[iUnit]) : 'g';
    if (!name || !Number.isFinite(value) || value <= 0) { skipped++; continue; }
    const mu = unit === 'ml' ? 'ml' : 'g';
    const where = sku ? { sku } : { name };
    const matches = await prisma.stockItem.findMany({ where, select: { id: true } });
    if (matches.length === 0) { unmatched++; console.log(`   ⚠ no match: ${name}`); continue; }
    if (matches.length > 1 && !sku) { skipped++; console.log(`   ⚠ ambiguous (add sku): ${name}`); continue; }
    for (const m of matches) {
      await prisma.stockItem.update({ where: { id: m.id }, data: { measurePerCountUnit: value, measureUnit: mu } });
      applied++;
    }
  }
  console.log(`\n✅ Applied measures to ${applied} items · skipped ${skipped} · unmatched ${unmatched}.`);
  await prisma.$disconnect();
}

async function detect() {
  // Recipe lines in a metric unit, with a linked item.
  const lines = await prisma.recipeLine.findMany({
    where: { itemId: { not: null }, unit: { not: null } },
    select: { unit: true, item: { select: { id: true, name: true, sku: true, unit: true, countUnit: true, measurePerCountUnit: true } } }
  });
  const need = new Map<string, { name: string; sku: string | null; costUnit: string }>();
  for (const l of lines) {
    if (!l.item || !isMetric(l.unit)) continue;
    const costUnit = l.item.countUnit ?? l.item.unit;
    if (isMetric(costUnit)) continue;            // item already costed by weight/volume → fine
    if (l.item.measurePerCountUnit) continue;     // already has a measure
    need.set(l.item.id, { name: l.item.name, sku: l.item.sku, costUnit });
  }

  const out: Array<{ name: string; sku: string; countUnit: string; value: number; unit: string }> = [];
  for (const { name, sku, costUnit } of need.values()) {
    const s = suggestMeasure(name, costUnit);
    out.push({ name, sku: sku ?? '', countUnit: costUnit, value: s.value, unit: s.unit });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`\n${out.length} items break recipe costs (weight/volume line → count-unit item, no measure set).`);
  console.log('Suggested starting measures (REVIEW — these are estimates):\n');
  for (const o of out.slice(0, 100)) {
    console.log(`  ${`${o.value} ${o.unit}`.padStart(9)} / ${o.countUnit.slice(0, 10).padEnd(10)}  ${o.name.slice(0, 50)}`);
  }
  if (out.length > 100) console.log(`  …and ${out.length - 100} more`);

  const csv = ['item,sku,count_unit,measure_per_count_unit,measure_unit',
    ...out.map((o) => [o.name, o.sku, o.countUnit, String(o.value), o.unit].map(csvCell).join(','))].join('\n');
  writeFileSync(CSV_PATH, csv + '\n', 'utf8');
  console.log(`\n📝 Wrote ${out.length} rows → ${CSV_PATH}`);
  console.log(`Review/edit the numbers, then apply: MEASURE_CONFIRM=YES ./scripts/suggest-item-measures.sh`);
  await prisma.$disconnect();
}

(CONFIRM ? applyFromCsv() : detect()).catch((err) => { console.error(err); process.exit(1); });
