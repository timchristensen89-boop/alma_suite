import { prisma } from '@alma/db';

const money = (c: number) => '$' + (c / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s: string, n: number) => (s + ' '.repeat(n)).slice(0, n);
const ym = (d: Date | null) => (d ? d.toISOString().slice(0, 7) : 'NO-DATE');

async function main() {
  const sinceMonths = 6;
  const since = new Date(Date.now() - sinceMonths * 31 * 86_400_000);

  const rows = await prisma.supplierInvoice.findMany({
    where: { OR: [{ invoiceDate: { gte: since } }, { invoiceDate: null }] },
    select: { venue: true, status: true, invoiceDate: true, totalCents: true, supplierName: true, source: true }
  });

  console.log(`\n=== SupplierInvoice (Xero bills) — last ~${sinceMonths} months — ${rows.length} rows ===`);

  // The report's COGS purchases = status != DRAFT, venue set, invoiceDate in range.
  // Show what passes that filter vs what's excluded and why.
  const byStatus = new Map<string, { n: number; cents: number }>();
  const byVenue = new Map<string, { n: number; cents: number }>();
  let nullDate = 0;
  for (const r of rows) {
    const s = byStatus.get(r.status) ?? { n: 0, cents: 0 };
    s.n += 1; s.cents += r.totalCents; byStatus.set(r.status, s);
    const vk = r.venue ?? '(no venue)';
    const v = byVenue.get(vk) ?? { n: 0, cents: 0 };
    v.n += 1; v.cents += r.totalCents; byVenue.set(vk, v);
    if (!r.invoiceDate) nullDate += 1;
  }

  console.log('\nBY STATUS (report counts everything except DRAFT):');
  for (const [s, a] of [...byStatus.entries()].sort((x, y) => y[1].cents - x[1].cents)) {
    console.log(`  ${pad(s, 16)} ${pad(String(a.n) + ' bills', 12)} ${money(a.cents)}${s === 'DRAFT' ? '   ← EXCLUDED from COGS' : ''}`);
  }

  console.log('\nBY VENUE (a venue-filtered report drops "(no venue)"):');
  for (const [v, a] of [...byVenue.entries()].sort((x, y) => y[1].cents - x[1].cents)) {
    console.log(`  ${pad(v, 16)} ${pad(String(a.n) + ' bills', 12)} ${money(a.cents)}${v === '(no venue)' ? '   ← dropped when a venue is selected' : ''}`);
  }
  if (nullDate) console.log(`\n⚠️  ${nullDate} bills have NO invoiceDate → excluded from every month range.`);

  // What COGS actually sees: status != DRAFT, by month × venue.
  console.log('\n=== PURCHASES THE REPORT SEES (status≠DRAFT) — month × venue ===');
  const cell = new Map<string, number>();
  const months = new Set<string>();
  const venues = new Set<string>();
  for (const r of rows) {
    if (r.status === 'DRAFT') continue;
    const m = ym(r.invoiceDate);
    const v = r.venue ?? '(no venue)';
    months.add(m); venues.add(v);
    cell.set(`${m}|${v}`, (cell.get(`${m}|${v}`) ?? 0) + r.totalCents);
  }
  const venueList = [...venues].sort();
  console.log(`${pad('MONTH', 10)} ${venueList.map((v) => pad(v, 16)).join(' ')}`);
  for (const m of [...months].sort()) {
    console.log(`${pad(m, 10)} ${venueList.map((v) => pad(money(cell.get(`${m}|${v}`) ?? 0), 16)).join(' ')}`);
  }

  const latest = rows.map((r) => r.invoiceDate).filter(Boolean).sort((a, b) => (b as Date).getTime() - (a as Date).getTime())[0];
  console.log(`\nLatest bill invoiceDate: ${latest ? (latest as Date).toISOString().slice(0, 10) : '(none)'}`);
  console.log('\nReads: if a month/venue is blank → no non-draft bills there (sync gap, wrong venue, or all DRAFT).');
  console.log('"(no venue)" with $ → the Xero→venue mapping is dropping bills from venue-filtered COGS.');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
