import { prisma } from '@alma/db';

// Backfill the venue on Xero supplier bills that imported "Unassigned" because
// the "Alma Freshwater Pty Ltd" org name didn't resolve to a venue. Avalon
// bills resolve fine, so every null-venue XERO bill is St Alma's.
// DRY RUN by default — set BACKFILL_CONFIRM=YES to actually write.

const CONFIRM = process.env.BACKFILL_CONFIRM === 'YES';
const TARGET_VENUE = process.env.BACKFILL_VENUE || 'St Alma';
const money = (c: number) => '$' + (c / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 });

async function main() {
  const nulls = await prisma.supplierInvoice.findMany({
    where: { venue: null, source: 'XERO' },
    select: { supplierName: true, totalCents: true, invoiceDate: true }
  });
  const total = nulls.reduce((s, b) => s + b.totalCents, 0);
  console.log(`\n${nulls.length} unassigned XERO bills · ${money(total)} total`);
  console.log(`→ all from the "Alma Freshwater Pty Ltd" org = ${TARGET_VENUE} (Avalon bills already resolve, so none of these are Avalon).`);

  const bySupplier = new Map<string, { n: number; cents: number }>();
  for (const b of nulls) {
    const a = bySupplier.get(b.supplierName) ?? { n: 0, cents: 0 };
    a.n += 1; a.cents += b.totalCents; bySupplier.set(b.supplierName, a);
  }
  console.log('\nSuppliers (sanity-check these look like St Alma vendors):');
  for (const [s, a] of [...bySupplier.entries()].sort((x, y) => y[1].cents - x[1].cents).slice(0, 30)) {
    console.log(`  ${String(a.n).padStart(3)}×  ${money(a.cents).padStart(12)}  ${s}`);
  }

  if (!CONFIRM) {
    console.log(`\nDRY RUN — nothing changed. To apply, re-run with:`);
    console.log(`   BACKFILL_CONFIRM=YES ./scripts/cogs-backfill-venue.sh`);
    console.log(`(or BACKFILL_VENUE="Alma Avalon" BACKFILL_CONFIRM=YES … to target a different venue)`);
    await prisma.$disconnect();
    return;
  }

  const res = await prisma.supplierInvoice.updateMany({
    where: { venue: null, source: 'XERO' },
    data: { venue: TARGET_VENUE }
  });
  console.log(`\n✅ Updated ${res.count} bills → venue = "${TARGET_VENUE}". Per-venue COGS will now include them.`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
