import { prisma } from '@alma/db';

// READ ONLY. Which POS daily sales invoices already posted to Xero included
// gift cards sold at the till — posted, before the fix, as "Food sales" with
// TaxType OUTPUT — and how much GST that overstated, by venue and BAS
// quarter. For the accountant to adjust. It writes nothing: no database
// update, and it never calls Xero.
//
//   node --import tsx scripts/report-xero-gift-card-overstatement.ts
//
// Figures follow pushPosDayToXero exactly: the voucher's face value went into
// the Food line ex-GST (×10/11) and its GST (÷11) into the BAS.

const posted = await prisma.posXeroPost.findMany({
  where: { status: 'POSTED' },
  orderBy: [{ venue: 'asc' }, { serviceDate: 'asc' }],
  select: { venue: true, serviceDate: true, invoiceNumber: true, invoiceId: true, tenantId: true }
});

type Row = { venue: string; day: string; invoiceNumber: string | null; giftCents: number; cards: number };
const rows: Row[] = [];
for (const post of posted) {
  const lines = await prisma.posOrderLine.findMany({
    where: {
      isGiftCard: true,
      order: { venue: post.venue, serviceDate: post.serviceDate, status: 'PAID', training: false }
    },
    select: { totalCents: true }
  });
  if (!lines.length) continue;
  rows.push({
    venue: post.venue,
    day: post.serviceDate.toISOString().slice(0, 10),
    invoiceNumber: post.invoiceNumber,
    giftCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
    cards: lines.length
  });
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const quarterOf = (day: string) => {
  const [year, month] = day.split('-').map(Number);
  return `${year} Q${Math.ceil((month ?? 1) / 3)}`;
};

console.log(`${rows.length} posted day(s) included POS gift card sales.`);
for (const row of rows) {
  console.log(
    `${row.venue} | ${row.day} | ${row.invoiceNumber ?? '(no invoice number)'} | ${row.cards} card(s) ${money(row.giftCents)} | posted as food ex-GST ${money(Math.round((row.giftCents * 10) / 11))} + GST ${money(Math.round(row.giftCents / 11))}`
  );
}

const byQuarter = new Map<string, number>();
for (const row of rows) {
  const key = `${row.venue} | ${quarterOf(row.day)} (calendar quarter)`;
  byQuarter.set(key, (byQuarter.get(key) ?? 0) + row.giftCents);
}
if (byQuarter.size) console.log('\nGST overstated, by venue and quarter:');
for (const [key, giftCents] of byQuarter) {
  console.log(`${key}: gift cards ${money(giftCents)} → GST overstated ${money(Math.round(giftCents / 11))}`);
}
await prisma.$disconnect();
