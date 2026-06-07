import { prisma } from '@alma/db';

const money = (c: number) => '$' + (c / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s: string, n: number) => (s + ' '.repeat(n)).slice(0, n);

function metaRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function main() {
  const sinceDays = 60;
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  // 1) Square connections + their locations (id → name), so we can label
  //    location ids that appear in SalesActualEntry.externalId.
  const connections = await prisma.integrationConnection.findMany({
    where: { provider: 'SQUARE' },
    select: { id: true, providerAccountName: true, scopeType: true, status: true, metadata: true, lastSyncAt: true }
  });

  const locationName = new Map<string, string>();
  console.log(`\n=== SQUARE CONNECTIONS (${connections.length}) ===`);
  for (const c of connections) {
    const meta = metaRecord(c.metadata);
    const locs = Array.isArray(meta.squareLocations) ? meta.squareLocations.map(metaRecord) : [];
    console.log(`\n• ${c.providerAccountName ?? '(no account name)'}  [${c.scopeType}]  status=${c.status}  lastSync=${c.lastSyncAt?.toISOString().slice(0, 10) ?? '—'}`);
    for (const l of locs) {
      const id = String(l.id ?? '');
      const name = String(l.name ?? l.businessName ?? 'Unnamed');
      const tz = String(l.timezone ?? '');
      if (id) locationName.set(id, name);
      console.log(`    location ${pad(id, 16)} name="${name}"  business="${String(l.businessName ?? '')}"  tz=${tz}`);
    }
    if (!locs.length) console.log('    (no locations cached in metadata)');
  }

  // 2) SalesActualEntry attribution over the window. externalId format is
  //    `square:<account>:<locationId>:<serviceDateKey>` — parse it to show
  //    which Square location each venue's sales actually came from.
  const rows = await prisma.salesActualEntry.findMany({
    where: { serviceDate: { gte: since } },
    select: { venue: true, source: true, externalId: true, salesCents: true, serviceDate: true }
  });

  // By source (detects e.g. a manual import stacked on top of the Square sync).
  const bySource = new Map<string, { cents: number; rows: number }>();
  for (const r of rows) {
    const agg = bySource.get(r.source) ?? { cents: 0, rows: 0 };
    agg.cents += r.salesCents;
    agg.rows += 1;
    bySource.set(r.source, agg);
  }
  console.log(`\n=== SalesActualEntry BY SOURCE (last ${sinceDays} days) ===`);
  for (const [source, agg] of [...bySource.entries()].sort((a, b) => b[1].cents - a[1].cents)) {
    console.log(`  ${pad(source, 22)} ${pad(money(agg.cents), 16)} (${agg.rows} day-rows)`);
  }

  // By account+location → venue. THIS reveals cross-venue leakage.
  const byLoc = new Map<string, { account: string; locationId: string; venue: string; cents: number; rows: number }>();
  for (const r of rows) {
    if (!r.source.startsWith('square')) continue;
    const parts = r.externalId.split(':'); // square, account, locationId, dateKey
    const account = parts[1] ?? '?';
    const locationId = parts[2] ?? '?';
    const key = `${account}|${locationId}|${r.venue}`;
    const agg = byLoc.get(key) ?? { account, locationId, venue: r.venue, cents: 0, rows: 0 };
    agg.cents += r.salesCents;
    agg.rows += 1;
    byLoc.set(key, agg);
  }
  console.log(`\n=== Square sales: ACCOUNT · LOCATION → VENUE (last ${sinceDays} days) ===`);
  console.log(`${pad('ACCOUNT', 10)} ${pad('LOCATION (name)', 34)} ${pad('→ FILED UNDER VENUE', 18)} ${pad('TOTAL', 16)} DAYS`);
  for (const a of [...byLoc.values()].sort((x, y) => x.account.localeCompare(y.account) || y.cents - x.cents)) {
    const locLabel = `${a.locationId} ${locationName.get(a.locationId) ? '(' + locationName.get(a.locationId) + ')' : ''}`.trim();
    console.log(`${pad(a.account, 10)} ${pad(locLabel, 34)} ${pad(a.venue, 18)} ${pad(money(a.cents), 16)} ${a.rows}`);
  }

  // Totals per venue (what the report shows).
  const byVenue = new Map<string, number>();
  for (const r of rows) byVenue.set(r.venue, (byVenue.get(r.venue) ?? 0) + r.salesCents);
  console.log(`\n=== REPORT SALES TOTAL BY VENUE (last ${sinceDays} days, incl GST + tips) ===`);
  for (const [venue, cents] of [...byVenue.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(venue, 20)} ${money(cents)}`);
  }
  console.log('\nNote: pre-backfill these are Square "Total Collected" (incl GST + tips); after a 90-day');
  console.log('Square backfill they restate to ex-GST/ex-tip Net Sales (≈10% lower).');

  // Missing-day analysis: are the gaps a regular weekday (= closed days, expected)
  // or scattered (= real sync gaps the 90-day backfill should fill)?
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const presentByVenue = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = r.serviceDate.toISOString().slice(0, 10);
    const set = presentByVenue.get(r.venue) ?? new Set<string>();
    set.add(key);
    presentByVenue.set(r.venue, set);
  }
  console.log(`\n=== MISSING DAYS BY VENUE (last ${sinceDays} days) ===`);
  for (const venue of byVenue.keys()) {
    const present = presentByVenue.get(venue) ?? new Set<string>();
    const missing: string[] = [];
    const wd = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < sinceDays; i += 1) {
      const d = new Date(since.getTime() + i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      if (!present.has(key)) {
        missing.push(key);
        wd[d.getUTCDay()] += 1;
      }
    }
    console.log(`\n${venue} — ${present.size} days with sales, ${missing.length} missing`);
    console.log(`  missing by weekday: ${WD.map((w, i) => `${w}:${wd[i]}`).join('  ')}`);
    console.log(`  missing dates: ${missing.join(', ') || '(none)'}`);
  }
  console.log('\nClustered on one/two weekdays → those are closed days (expected, no row).');
  console.log('Scattered across weekdays → real sync gaps; a 90-day Square backfill will fill them.');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
