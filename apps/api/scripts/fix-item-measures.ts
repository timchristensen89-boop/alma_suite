import { prisma } from '@alma/db';

// Repair measurePerCountUnit / measureUnit on count-unit items by parsing the
// REAL pack size out of the item name (e.g. "BEANS BLACK DRY 1KG" → 1000 g,
// "DON JULIO 750ML BOTTLE" → 750 ml, "Triple SEC 20L" → 20000 ml). The earlier
// suggest pass stamped a generic 100 g on everything, which is up to 10× off and
// uses grams for bottles that recipes pour by the mL. This re-derives them from
// the name, which is authoritative for any item whose pack size is in the title.
//
// Items with NO size token (fresh produce sold by piece/bunch/tray, or a wine
// named without its bottle size) fall back to sensible per-unit defaults — wine
// & spirit bottles default to 750 ml so cocktails cost correctly.
//
// DRY RUN by default — set FIX_MEASURE_CONFIRM=YES to write.
//   ./scripts/fix-item-measures.sh
//   FIX_MEASURE_CONFIRM=YES ./scripts/fix-item-measures.sh

const CONFIRM = process.env.FIX_MEASURE_CONFIRM === 'YES';

const METRIC = new Set(['g', 'gm', 'gr', 'gram', 'grams', 'kg', 'kgs', 'mg', 'ml', 'millilitre', 'milliliter', 'l', 'lt', 'ltr', 'litre', 'liter', 'cl', 'dl']);
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const isMetric = (u: string | null | undefined) => METRIC.has(norm(u));

// Parse the largest plausible pack-size token from a name → grams or millilitres.
const SIZE_RE = /(\d+(?:\.\d+)?)\s*(kgs?|kg|g|gm|gr|grams?|mg|mls?|millilitres?|milliliters?|ltrs?|lts?|l|litres?|liters?)\b/gi;
function measureFromName(name: string): { value: number; unit: 'g' | 'ml' } | null {
  let m: RegExpExecArray | null;
  const hits: { value: number; unit: 'g' | 'ml' }[] = [];
  SIZE_RE.lastIndex = 0;
  while ((m = SIZE_RE.exec(name)) !== null) {
    const n = parseFloat(m[1]!);
    const u = m[2]!.toLowerCase();
    if (!Number.isFinite(n) || n <= 0) continue;
    if (/^kg/.test(u)) hits.push({ value: n * 1000, unit: 'g' });
    else if (u === 'mg') hits.push({ value: n / 1000, unit: 'g' });
    else if (/^g/.test(u)) hits.push({ value: n, unit: 'g' });
    else if (/^ml|^millilit|^milili/.test(u)) hits.push({ value: n, unit: 'ml' });
    else if (/^l$|^lt|^ltr|^litre|^liter/.test(u)) hits.push({ value: n * 1000, unit: 'ml' });
  }
  if (hits.length === 0) return null;
  // Prefer the largest token — that's the pack/bottle size, not a small sub-qty.
  return hits.sort((a, b) => b.value - a.value)[0]!;
}

function fallbackMeasure(name: string, costUnit: string, categoryName: string | null): { value: number; unit: 'g' | 'ml' } | null {
  const n = name.toLowerCase();
  const cu = costUnit.toLowerCase();
  const cat = (categoryName ?? '').toLowerCase();
  const isBottle = cu.includes('bottle') || /wine|spirit|liqueur|aperitif|tequila|mezcal/.test(cat);
  if (isBottle) return { value: 750, unit: 'ml' };
  // fresh produce / counted goods sold without a size in the name
  if (/(coriander|parsley|mint|basil|dill|tarragon|chive|thyme|rosemary|oregano|sage)/.test(n) && cu.includes('bunch')) return { value: 30, unit: 'g' };
  if (cu.includes('bunch')) return { value: 120, unit: 'g' };
  if (cu.includes('punnet')) return { value: 200, unit: 'g' };
  if (cu.includes('tray')) return { value: 1000, unit: 'g' };
  if (cu.includes('box')) return { value: 2000, unit: 'g' };
  if (cu.includes('head')) return { value: 400, unit: 'g' };
  if (/(each|ea|unit|pc|piece)/.test(cu)) {
    if (/(lime|lemon)/.test(n)) return { value: 70, unit: 'g' };
    if (/avocado/.test(n)) return { value: 200, unit: 'g' };
    if (/(lettuce|cabbage|cauliflower|pineapple)/.test(n)) return { value: 400, unit: 'g' };
    return { value: 100, unit: 'g' };
  }
  return null;
}
const round = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const items = await prisma.stockItem.findMany({
    select: { id: true, name: true, unit: true, countUnit: true, measurePerCountUnit: true, measureUnit: true, category: { select: { name: true } } }
  });

  type Plan = { id: string; name: string; from: string; value: number; unit: 'g' | 'ml'; src: 'name' | 'fallback' };
  const updates: Plan[] = [];
  let skippedMetric = 0, noBasis = 0;

  for (const it of items) {
    const costUnit = it.countUnit ?? it.unit;
    if (isMetric(costUnit)) { skippedMetric++; continue; } // already costed by weight/volume
    const parsed = measureFromName(it.name);
    const chosen = parsed ?? fallbackMeasure(it.name, costUnit, it.category?.name ?? null);
    if (!chosen) { noBasis++; continue; }
    const value = round(chosen.value);
    if (it.measurePerCountUnit === value && norm(it.measureUnit) === chosen.unit) continue; // already correct
    const from = it.measurePerCountUnit == null ? '—' : `${it.measurePerCountUnit} ${it.measureUnit ?? '?'}`;
    updates.push({ id: it.id, name: it.name, from, value, unit: chosen.unit, src: parsed ? 'name' : 'fallback' });
  }

  const fromName = updates.filter((u) => u.src === 'name').length;
  console.log(`\nItems: ${items.length} · already metric ${skippedMetric} · no basis ${noBasis} · to fix ${updates.length} (${fromName} from name, ${updates.length - fromName} fallback)`);
  console.log('\n=== old → new (sample) ===');
  for (const u of updates.slice(0, 80)) {
    console.log(`  ${u.from.padStart(10)} → ${`${u.value} ${u.unit}`.padStart(10)}  [${u.src}]  ${u.name.slice(0, 48)}`);
  }
  if (updates.length > 80) console.log(`  …and ${updates.length - 80} more`);

  if (!CONFIRM) {
    console.log(`\nDRY RUN — nothing changed. To apply: FIX_MEASURE_CONFIRM=YES ./scripts/fix-item-measures.sh`);
    await prisma.$disconnect();
    return;
  }
  let n = 0;
  for (const u of updates) {
    await prisma.stockItem.update({ where: { id: u.id }, data: { measurePerCountUnit: u.value, measureUnit: u.unit } });
    n++;
  }
  console.log(`\n✅ Repaired measures on ${n} items from their real pack sizes.`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
