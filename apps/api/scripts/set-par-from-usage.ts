import { prisma } from '@alma/db';

// Set par levels from real usage: for each item at each venue, par is taken from
// what we've actually been holding — the upper end (75th percentile) of recent
// stocktake counts — with the reorder point at roughly half that. Uses the last
// PAR_LOOKBACK_DAYS of completed stocktakes.
//
// DRY RUN by default — set PAR_CONFIRM=YES to write.
//   ./scripts/set-par-from-usage.sh
//   PAR_CONFIRM=YES ./scripts/set-par-from-usage.sh

const CONFIRM = process.env.PAR_CONFIRM === 'YES';
const LOOKBACK_DAYS = Number(process.env.PAR_LOOKBACK_DAYS) || 120;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  const stocktakes = await prisma.stocktake.findMany({
    where: { countedAt: { gte: since }, status: { in: ['SUBMITTED', 'APPROVED', 'COMPLETED', 'COUNTED'] } },
    select: { venue: true, lines: { select: { itemId: true, countedQty: true } } }
  });

  // (itemId|venue) -> list of counted quantities
  const counts = new Map<string, number[]>();
  for (const st of stocktakes) {
    const venue = st.venue ?? '';
    for (const line of st.lines) {
      if (!line.itemId || line.countedQty == null) continue;
      const key = `${line.itemId}|${venue}`;
      const list = counts.get(key) ?? []; list.push(line.countedQty); counts.set(key, list);
    }
  }

  const venueStock = await prisma.venueStockItem.findMany({
    select: { id: true, venue: true, stockItemId: true, parLevel: true, reorderPoint: true, stockItem: { select: { name: true } } }
  });

  type Plan = { id: string; name: string; venue: string; par: number; reorder: number; oldPar: number | null };
  const updates: Plan[] = [];
  for (const vs of venueStock) {
    const samples = counts.get(`${vs.stockItemId}|${vs.venue}`) ?? counts.get(`${vs.stockItemId}|`) ?? [];
    if (samples.length === 0) continue;
    const par = Math.ceil(percentile(samples, 75));
    if (par <= 0) continue;
    const reorder = Math.max(1, Math.ceil(par * 0.5));
    if (vs.parLevel === par && vs.reorderPoint === reorder) continue;
    updates.push({ id: vs.id, name: vs.stockItem.name, venue: vs.venue, par, reorder, oldPar: vs.parLevel });
  }

  console.log(`\nStocktakes (last ${LOOKBACK_DAYS}d): ${stocktakes.length} · venue-stock rows: ${venueStock.length} · par updates: ${updates.length}`);
  console.log('\n=== sample (old par → new par / reorder) ===');
  for (const u of updates.slice(0, 40)) {
    console.log(`  ${u.venue.slice(0, 12).padEnd(12)}  ${String(u.oldPar ?? '—').padStart(4)} → ${String(u.par).padStart(4)} / ro ${u.reorder}   ${u.name.slice(0, 44)}`);
  }
  if (updates.length > 40) console.log(`  …and ${updates.length - 40} more`);

  if (!CONFIRM) {
    console.log(`\nDRY RUN — nothing changed. To apply: PAR_CONFIRM=YES ./scripts/set-par-from-usage.sh`);
    await prisma.$disconnect();
    return;
  }

  let n = 0;
  for (const u of updates) {
    await prisma.venueStockItem.update({ where: { id: u.id }, data: { parLevel: u.par, reorderPoint: u.reorder } });
    n++;
  }
  console.log(`\n✅ Set par + reorder on ${n} venue-stock rows from usage.`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
