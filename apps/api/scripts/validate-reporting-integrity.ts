/**
 * READ-ONLY validation of the corrected reporting rules against a real
 * database (a restore of last night's dump, or the VPS database itself —
 * every query here is a SELECT; nothing is written).
 *
 * It answers, for the group and each venue:
 *   1. stocktake cadence (observed gaps between finalised counts) and how many
 *      month boundaries have a bracket under 14 / 21 / 31 days;
 *   2. actual COGS per period with both brackets spelled out (date, age,
 *      status), unattributed purchases, quality and reasons;
 *   3. Recap vs Prime Cost agreement for the same period;
 *   4. theoretical COGS scope: total vs mapped item sales, serve-size gaps,
 *      zero-cost and suspect recipes, mapped > total;
 *   5. stock on hand: corrected latest-valid-count value vs the old
 *      all-lines-ever aggregate;
 *   6. forecast labour populations (salaried / hourly / missing rate, named);
 *   7. data-quality counts behind every "unavailable".
 *
 * Run:
 *   DATABASE_URL=postgresql://… node --import tsx apps/api/scripts/validate-reporting-integrity.ts [YYYY-MM …]
 * Months default to: last complete month, the month before it, and the
 * current month to date.
 */
import { prisma, computeActualCogs, stockBracket, prismaCogsReader, partitionCountLabels, type ActualCogs } from '@alma/db';
import {
  STOCKTAKE_BOUNDARY_WINDOW_DAYS,
  STOCKTAKE_STALE_DAYS,
  assessStocktakeValuation,
  isSuspectRecipeCost,
  realVenueNames,
  recipePortionCost,
  resolveVenueLabel,
  shiftMonthKey,
  venueDayKey,
  venueMonthBounds,
  venueMonthKey
} from '@alma/shared';
import { classifyLabourPopulation } from '../src/lib/forecast/labour-population.js';
import { staffPayRateSelect } from '../src/lib/staff-pay-rates.js';
import { reportsService } from '../src/services/reports.service.js';
import { configuredSuperRateFraction, settingsService } from '../src/services/settings.service.js';

const money = (cents: number | null | undefined) => (cents == null ? 'unavailable' : `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const DAY_MS = 86_400_000;
const FINALISED = ['SUBMITTED', 'REVIEWED', 'LOCKED'] as const;

function section(title: string) {
  console.log(`\n${'═'.repeat(78)}\n${title}\n${'═'.repeat(78)}`);
}

function describeBracket(label: string, b: ActualCogs['opening']) {
  const head = `${label}: ${b.status.toUpperCase()} value=${money(b.valueCents)} composition=${b.composition ?? '—'} nearest=${b.countedOn ?? '—'} distance=${b.distanceDays ?? '—'}d (window ±${b.windowDays}d)`;
  const lines = [head];
  for (const c of b.components) lines.push(`      used     ${c.scope.padEnd(9)} ${c.countedOn} (${c.side}, ${c.distanceDays}d) ${money(c.valueCents)} ← ${c.names.join(' + ')}`);
  for (const r of b.rejected) lines.push(`      rejected ${r.scope.padEnd(9)} ${r.countedOn} (${r.distanceDays}d) ${money(r.valueCents)} "${r.name}" — ${r.reason}: ${r.detail}`);
  for (const v of b.venuesWithoutCount) lines.push(`      short    ${v.venue}: ${v.status} — ${v.detail}`);
  for (const w of b.warnings) lines.push(`      warning  ${w}`);
  return lines.join('\n    ');
}

async function stocktakeCadence(venues: string[]) {
  section('1. Stocktake cadence (finalised counts, grouped by venue day) — operational freshness vs boundary validity');
  console.log('Two different questions: "how recently was this venue counted?" (freshness) and "how far is the count used for a period boundary from that boundary?" (validity). A recent count is not a month-end bracket unless it sits near the month end.');
  const counts = await prisma.stocktake.findMany({
    where: { status: { in: [...FINALISED] } },
    select: { venue: true, countedAt: true, status: true, lines: { select: { stockValueCents: true } } },
    orderBy: { countedAt: 'asc' }
  });
  // Stored labels resolve to configured venues through the shared rule; the
  // rest are off-venue and listed on their own.
  const byVenue = new Map<string, string[]>();
  const offVenue: Array<{ label: string; status: string; day: string; valueCents: number }> = [];
  for (const c of counts) {
    const resolved = resolveVenueLabel(c.venue, venues);
    const day = venueDayKey(c.countedAt);
    const valueCents = c.lines.reduce((sum, l) => sum + (l.stockValueCents ?? 0), 0);
    if (!resolved.venue) {
      offVenue.push({ label: c.venue ?? '(null)', status: resolved.status, day, valueCents });
      continue;
    }
    const list = byVenue.get(resolved.venue) ?? [];
    if (list[list.length - 1] !== day) list.push(day);
    byVenue.set(resolved.venue, list);
  }
  const now = new Date();
  console.log(`\nOperational freshness today (${venueDayKey(now)}):`);
  for (const venue of venues) {
    const days = byVenue.get(venue) ?? [];
    const latest = days[days.length - 1] ?? null;
    const age = latest ? Math.floor((now.getTime() - new Date(latest).getTime()) / DAY_MS) : null;
    console.log(`  ${venue}: latest count ${latest ?? 'none'} · ${age ?? '—'} days ago`);
  }
  for (const [venue, days] of byVenue) {
    const gaps: number[] = [];
    for (let i = 1; i < days.length; i += 1) gaps.push(Math.round((new Date(days[i]!).getTime() - new Date(days[i - 1]!).getTime()) / DAY_MS));
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
    const cadence = median == null ? 'single count' : median <= 9 ? 'weekly' : median <= 18 ? 'fortnightly' : median <= 38 ? 'monthly' : 'irregular / sparse';
    const pseudo = !venues.includes(venue) ? '  ⚠ NOT a configured venue — the group bracket treats it as one' : '';
    console.log(`\n${venue}${pseudo}\n  count days (${days.length}): ${days.join(', ')}\n  gaps (days): ${gaps.join(', ') || '—'} · median ${median ?? '—'} · min ${sorted[0] ?? '—'} · max ${sorted[sorted.length - 1] ?? '—'} → ${cadence}`);
    // Month boundaries over the last 12 months: which have a bracket under each tolerance?
    const rows: string[] = [];
    const supported = new Map<number, number>([[7, 0], [14, 0], [21, 0], [31, 0]]);
    let month = venueMonthKey(now);
    for (let i = 0; i < 13; i += 1) {
      const bounds = venueMonthBounds(month)!;
      const at = bounds.gte;
      const latest = [...days].reverse().find((d) => new Date(d) <= at) ?? null;
      const age = latest ? Math.floor((at.getTime() - new Date(latest).getTime()) / DAY_MS) : null;
      const ok = (limit: number) => (age != null && age <= limit ? 'ok' : 'NO');
      rows.push(`${month}-01: candidate count ${latest ?? 'none'} · distance ${age ?? '—'}d → 7d:${ok(7)} 14d:${ok(14)} 21d:${ok(21)} 31d:${ok(31)}`);
      if (age != null) for (const [limit, tally] of supported) if (age <= limit) supported.set(limit, tally + 1);
      month = shiftMonthKey(month, -1)!;
    }
    console.log(`  boundary validity (13 month starts):\n    ${rows.join('\n    ')}`);
    console.log(`  boundaries supported: ${[...supported.entries()].map(([l, n]) => `${l}d → ${n}/13`).join(' · ')}`);
  }
  console.log(`\nOff-venue finalised counts (label is not a configured venue; listed, never used, never rewritten): ${offVenue.length} of ${counts.length}`);
  for (const row of offVenue) console.log(`  label "${row.label}" (${row.status}) · counted ${row.day} · value ${money(row.valueCents)} · unattributed`);
  const parts = await partitionCountLabels(prismaCogsReader, now);
  console.log(`Stored labels → configured venue: ${[...parts.labelsByVenue.entries()].map(([v, labels]) => `${v} ← [${labels.map((l) => `"${l}"`).join(', ')}]`).join(' · ')}`);
}

async function actualCogs(venues: string[], months: string[]) {
  section(`2. Actual COGS (boundary window ±${STOCKTAKE_BOUNDARY_WINDOW_DAYS} days; a boundary is one COMBINED count or a FOOD + BEVERAGE pair, of known scope, sufficiently valued)`);
  for (const month of months) {
    const bounds = venueMonthBounds(month)!;
    console.log(`\n── ${month} (${bounds.gte.toISOString()} → ${bounds.lt.toISOString()})`);
    for (const venue of [null, ...venues]) {
      const c = await computeActualCogs({ venue, start: bounds.gte, end: bounds.lt });
      console.log(`\n  ${venue ?? 'GROUP'}`);
      console.log(`    ${describeBracket('opening', c.opening)}`);
      console.log(`    purchases (ex-GST, finalised): ${money(c.purchasesCents)}${venue ? ` · unattributed (no venue on invoice): ${money(c.unattributedPurchasesCents)} across ${c.unattributedInvoiceCount} invoice(s)` : ''}`);
      console.log(`    ${describeBracket('closing', c.closing)}`);
      if (venue == null && (c.opening.offVenueCounts.length || c.closing.offVenueCounts.length)) {
        const seen = new Map<string, (typeof c.opening.offVenueCounts)[number]>();
        for (const o of [...c.opening.offVenueCounts, ...c.closing.offVenueCounts]) seen.set(`${o.sourceLabel}|${o.countedOn}`, o);
        console.log(`    off-venue counts on or before the boundaries: ${[...seen.values()].map((o) => `"${o.sourceLabel || '(blank)'}" ${o.countedOn} ${money(o.valueCents)} (${o.resolution})`).join('; ')}`);
      }
      console.log(`    quality=${c.quality} source=${c.source} → ${c.quality === 'complete' ? `actual COGS ${money(c.cogsCents)}` : `UNAVAILABLE (purchases shown as purchases ${money(c.purchasesCents)})`}`);
      for (const r of c.reasons) console.log(`      • ${r}`);
      for (const w of c.warnings) console.log(`      ⚠ ${w}`);
    }
  }
}

async function recapVsPrime(venues: string[], months: string[]) {
  section('3. Monthly Recap vs Prime Cost report (same population)');
  const admin = { id: 'validation', isAdmin: true, role: 'ADMIN', venue: null } as any;
  for (const month of months) {
    const bounds = venueMonthBounds(month)!;
    for (const venue of [null, ...venues]) {
      const recap = await reportsService.monthlyRecap({ month, venue: venue ?? undefined }, admin);
      const prime = await reportsService.primeCost({ start: bounds.gte.toISOString(), end: bounds.lt.toISOString(), venue: venue ?? undefined }, admin);
      const m = recap.monthCurrent;
      const t = prime.totals;
      const agree = m.primeCostCents === t.primeCostCents && m.salesCents === t.salesCents;
      console.log(`\n  ${month} · ${venue ?? 'GROUP'} · targets ${recap.targets.source} (wage ${recap.targets.wagePct} / food ${recap.targets.foodPct} / prime ${recap.targets.primePct})`);
      console.log(`    Recap : sales ${money(m.salesCents)} labour ${money(m.wageCents)} food ${m.foodBasis === 'actual' ? money(m.cogsCents) : `unavailable (purchases ${money(m.purchasesCents)})`} prime ${money(m.primeCostCents)} ${m.primePct ?? '—'}%`);
      console.log(`    Prime : sales ${money(t.salesCents)} labour ${money(t.wageCents)} (${t.labourBasis}${t.rosterOnlyWageCents ? `; roster-only ${money(t.rosterOnlyWageCents)} in ${t.rosterOnlyVenues.join(', ')} excluded` : ''}) food ${t.foodBasis === 'actual' ? money(t.cogsCents) : `unavailable (purchases ${money(t.purchasesCents)})`} prime ${money(t.primeCostCents)} ${t.primeCostPercent ?? '—'}% · coverage ${Math.round(t.purchaseCoverage * 100)}%`);
      console.log(`    agree on sales, labour and prime: ${agree && m.wageCents === t.wageCents ? 'YES' : 'NO ← investigate'}`);
      for (const row of prime.venues) console.log(`      row ${row.venue.padEnd(14)} labour ${money(row.wageCents)} (${row.labourBasis}; timesheets ${money(row.wageCents === row.rosterWageEstimateCents && row.labourBasis === 'roster_estimate' ? 0 : row.wageCents)}, roster estimate ${money(row.rosterWageEstimateCents)}, ${row.timesheetHours}h / ${row.rosterHours}h)`);
      const f = t.purchaseFeed;
      console.log(`    invoice feed: ${f.status} · coverage ${Math.round(f.coverage * 100)}% · ${f.firstInvoiceDate ?? '—'} → ${f.lastInvoiceDate ?? '—'} over ${f.elapsedDays} elapsed days${f.missingInterval ? ` · missing ${f.missingInterval.from} → ${f.missingInterval.to}` : ''} · established suppliers ${f.establishedSuppliers}${f.absentEstablishedSuppliers.length ? ` · ABSENT: ${f.absentEstablishedSuppliers.map((s) => `${s.supplierName} (last ${s.lastInvoiceBefore})`).join('; ')}` : ''}`);
      for (const r of m.reasons) console.log(`      • ${r}`);
    }
  }
}

async function theoreticalScope(venues: string[]) {
  section('4. Theoretical COGS scope (last 30 venue days)');
  const now = new Date();
  const end = venueMonthBounds(venueMonthKey(now))!.gte; // start of this month as a stable window end
  const start = new Date(end.getTime() - 30 * DAY_MS);
  const recipes = await prisma.recipe.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, title: true, venue: true, estimatedCost: true, yieldQuantity: true, yieldUnit: true, portionSize: true, isPrepRecipe: true }
  });
  const serveSizeRequired = recipes.filter((r) => !r.isPrepRecipe && recipePortionCost(r).reason === 'serve_size_required');
  const uncosted = recipes.filter((r) => !r.isPrepRecipe && !((r.estimatedCost ?? 0) > 0));
  console.log(`active recipes ${recipes.length} · menu (non-prep) ${recipes.filter((r) => !r.isPrepRecipe).length} · uncosted ${uncosted.length} · SERVE SIZE REQUIRED (yield in g/ml/kg/l, no serve size) ${serveSizeRequired.length}`);
  for (const r of serveSizeRequired.slice(0, 25)) console.log(`  serve size required: ${r.title} (${r.venue ?? 'shared'}) yield ${r.yieldQuantity} ${r.yieldUnit}, batch ${money(Math.round((r.estimatedCost ?? 0) * 100))}`);
  for (const venue of [null, ...venues]) {
    const [total, mapped] = await Promise.all([
      prisma.salesItemActualEntry.aggregate({ _sum: { netSalesCents: true }, where: { serviceDate: { gte: start, lt: end }, ...(venue ? { venue } : {}) } }),
      prisma.salesItemActualEntry.groupBy({ by: ['recipeId'], where: { serviceDate: { gte: start, lt: end }, recipeId: { not: null }, ...(venue ? { venue } : {}) }, _sum: { netSalesCents: true, quantity: true } })
    ]);
    const byId = new Map(recipes.map((r) => [r.id, r]));
    let mappedCents = 0, theoretical = 0, suspect = 0, zero = 0, valid = 0, excluded = 0, validCents = 0, excludedCents = 0, suspectCents = 0;
    for (const row of mapped) {
      const r = byId.get(row.recipeId!);
      const net = row._sum.netSalesCents ?? 0;
      const qty = row._sum.quantity ?? 0;
      mappedCents += net;
      if (!r) { excluded += 1; excludedCents += net; continue; }
      if (serveSizeRequired.some((s) => s.id === r.id)) { excluded += 1; excludedCents += net; continue; }
      const serve = recipePortionCost(r).cents ?? 0;
      if (serve <= 0) { zero += 1; continue; }
      if (isSuspectRecipeCost(serve, net, qty)) { suspect += 1; suspectCents += net; continue; }
      valid += 1;
      validCents += net;
      theoretical += serve * qty;
    }
    const totalCents = total._sum.netSalesCents ?? 0;
    const share = totalCents > 0 ? Math.round((mappedCents / totalCents) * 1000) / 10 : null;
    console.log(`\n  ${venue ?? 'GROUP'}: total item sales ${money(totalCents)} · mapped ${money(mappedCents)} (${share ?? '—'}%)${share != null && share > 100.5 ? '  ⚠ MAPPED > TOTAL: population mismatch' : ''}`);
    console.log(`    valid-cost sales ${money(validCents)} · SERVE SIZE REQUIRED / unknown-recipe sales ${money(excludedCents)} (${excluded} recipes) · suspect sales ${money(suspectCents)} (${suspect}) · zero-cost recipes ${zero} (sales kept in denominator)`);
    console.log(`    theoretical COGS over valid-cost sales ${money(theoretical)}${validCents > 0 ? ` = ${Math.round((theoretical / validCents) * 1000) / 10}% of the ${money(validCents)} it covers` : ''} · coverage of all item sales ${totalCents > 0 ? `${Math.round((validCents / totalCents) * 1000) / 10}%` : '—'}`);
  }
}

async function stockOnHand(venues: string[]) {
  section('5. Stock on hand: corrected (latest valid count) vs old (every stocktake line ever)');
  const now = new Date();
  for (const venue of [null, ...venues]) {
    const bracket = await stockBracket(prismaCogsReader, venue, now, STOCKTAKE_STALE_DAYS);
    const old = await prisma.stocktakeLine.aggregate({ _sum: { stockValueCents: true }, where: venue ? { stocktake: { OR: [{ venue }, { venue: null }] } } : {} });
    console.log(`  ${venue ?? 'GROUP'}: NEW ${bracket.status === 'ok' ? `${money(bracket.valueCents)} (${bracket.composition}, ${bracket.countedOn})` : `unavailable (${bracket.status}${bracket.rejected.length ? `: ${bracket.rejected.map((r) => `${r.countedOn} ${r.scope} ${r.reason}`).join('; ')}` : ''}${bracket.venuesWithoutCount.length ? `: ${bracket.venuesWithoutCount.map((v) => `${v.venue} ${v.detail}`).join('; ')}` : ''})`}  ·  OLD summary aggregate ${money(old._sum.stockValueCents ?? 0)}`);
  }
}

async function labourPopulations() {
  section('6. Forecast labour populations (every active worker, by resolved rate)');
  const superRate = await configuredSuperRateFraction();
  const staff = await prisma.staffProfile.findMany({
    where: { accountType: 'HUMAN', mergedIntoStaffProfileId: null, employmentStatus: 'ACTIVE' },
    select: { id: true, firstName: true, lastName: true, venue: true, ...staffPayRateSelect }
  });
  const pop = classifyLabourPopulation(staff, superRate);
  console.log(`salaried ${pop.summary.salaried} · hourly ${pop.summary.hourly} · missing rate ${pop.summary.missingRate} · total ${staff.length}`);
  for (const row of pop.rows) {
    const p = staff.find((s) => s.id === row.staffProfileId)!;
    if (row.classification !== 'hourly') console.log(`  ${row.classification.padEnd(12)} ${p.firstName} ${p.lastName} (${p.venue ?? '—'}) · ${row.rateSource}${row.weeklyFixedCostCents ? ` · ${money(row.weeklyFixedCostCents)}/wk` : ''}`);
  }
  const twice = pop.rows.filter((r) => [pop.salariedIds, pop.hourlyIds, pop.missingRateIds].filter((s) => s.has(r.staffProfileId)).length !== 1);
  console.log(`workers in more or fewer than one population: ${twice.length}`);
}

async function dataQuality(venues: string[], months: string[]) {
  section('7. Data-quality counts behind the unavailable states');
  const [invoicesNoVenue, invoicesTotal, stocktakesOdd, unmappedItems] = await Promise.all([
    prisma.supplierInvoice.groupBy({ by: ['venue'], where: { status: { not: 'DRAFT' }, triageStatus: { not: 'NO_ITEM' } }, _count: { _all: true }, _sum: { subtotalCents: true } }),
    prisma.supplierInvoice.count({ where: { status: { not: 'DRAFT' }, triageStatus: { not: 'NO_ITEM' } } }),
    prisma.stocktake.groupBy({ by: ['venue', 'status'], _count: { _all: true } }),
    prisma.salesItemActualEntry.groupBy({ by: ['venue'], where: { recipeId: null, serviceDate: { gte: venueMonthBounds(months[months.length - 1]!)!.gte } }, _sum: { netSalesCents: true }, _count: { _all: true } })
  ]);
  console.log(`finalised stock invoices by venue (of ${invoicesTotal}):`);
  for (const row of invoicesNoVenue) console.log(`  ${row.venue ?? 'NO VENUE'}: ${row._count._all} invoices, ${money(row._sum.subtotalCents ?? 0)} ex-GST${row.venue && !venues.includes(row.venue) ? '  ⚠ not a configured venue' : ''}`);
  console.log(`stocktakes by venue/status:`);
  for (const row of stocktakesOdd) console.log(`  ${row.venue ?? 'NO VENUE'} · ${row.status}: ${row._count._all}${row.venue && !venues.includes(row.venue) ? '  ⚠ not a configured venue (Both / Unspecified)' : ''}`);
  console.log(`unmapped item sales since ${months[months.length - 1]}-01:`);
  for (const row of unmappedItems) console.log(`  ${row.venue}: ${row._count._all} rows, ${money(row._sum.netSalesCents ?? 0)}`);
}

async function scopeAndValuation(venues: string[], months: string[]) {
  section('8. Scope and valuation of every finalised count near the month boundaries (what the composition rule sees)');
  const first = venueMonthBounds(months[0]!)!.gte;
  const last = venueMonthBounds(months[months.length - 1]!)!.lt;
  const counts = await prisma.stocktake.findMany({
    where: {
      status: { in: [...FINALISED] },
      countedAt: { gte: new Date(first.getTime() - STOCKTAKE_BOUNDARY_WINDOW_DAYS * DAY_MS), lte: new Date(last.getTime() + STOCKTAKE_BOUNDARY_WINDOW_DAYS * DAY_MS) }
    },
    select: { id: true, name: true, venue: true, countedAt: true, countedAtText: true, countedAtSource: true, scope: true, scopeEvidence: true, importSource: true, template: true, lines: { select: { itemId: true, recipeId: true, countedQty: true, stockValueCents: true } } },
    orderBy: { countedAt: 'asc' }
  });
  for (const c of counts) {
    const v = assessStocktakeValuation(c.lines);
    const resolved = resolveVenueLabel(c.venue, venues);
    console.log(`  ${venueDayKey(c.countedAt)} ${(resolved.venue ?? `"${c.venue ?? ''}" (off-venue)`).padEnd(14)} ${c.scope.padEnd(9)} ${money(v.valueCents).padStart(12)}  lines ${v.lines} counted ${v.counted} zero ${v.zero} linked+valued ${v.linkedValued} unlinked+valued ${v.unlinkedValued} UNVALUED ${v.unvalued} → ${v.sufficient ? 'sufficient' : `INSUFFICIENT (${v.reason})`}`);
    console.log(`      "${c.name}" · template ${c.template ?? '—'} · source ${c.importSource ?? 'app'} · countedAt ${c.countedAt.toISOString()} (${c.countedAtSource ?? 'unrecorded'}${c.countedAtText ? `, printed "${c.countedAtText}"` : ''}) · scope evidence: ${c.scopeEvidence ?? '—'}`);
  }
}

async function main() {
  const settings = await settingsService.get();
  const venues = realVenueNames(settings.venues.map((v) => v.name));
  const thisMonth = venueMonthKey(new Date());
  const months = process.argv.slice(2).length ? process.argv.slice(2) : [shiftMonthKey(thisMonth, -2)!, shiftMonthKey(thisMonth, -1)!, thisMonth];
  console.log(`Venues: ${venues.join(', ')} · months: ${months.join(', ')} · read-only`);
  await stocktakeCadence(venues);
  await actualCogs(venues, months);
  await recapVsPrime(venues, months);
  await theoreticalScope(venues);
  await stockOnHand(venues);
  await labourPopulations();
  await scopeAndValuation(venues, months);
  await dataQuality(venues, months);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
