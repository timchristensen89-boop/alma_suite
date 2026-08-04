/**
 * Re-import Square item sales so the stored figures are ex-GST.
 *
 * `squareOrderLineNetCents` used Square's `total_money`, which is GST
 * inclusive, so every row in SalesItemActualEntry carries roughly 10% too
 * much. That is the whole of the 9.3% gap between the two revenue figures the
 * reports page showed. The fix corrects new imports; this brings the history
 * with it.
 *
 * The tax is not stored on the rows, so it cannot be subtracted after the
 * fact — the numbers have to come from Square again. The upsert is keyed on
 * (venue, serviceDate, source, externalId), so a re-import overwrites in place
 * rather than duplicating, and re-running a month that already succeeded is
 * harmless.
 *
 * Square caps an order search, so this walks a month at a time per account.
 *
 *   node --import tsx scripts/backfill-square-item-gst.ts 2025-07 2026-07
 */
import { prisma } from '@alma/db';
import { integrationService } from '../src/services/integration.service.js';

const actor: any = { id: 'gst-backfill', role: 'ADMIN', isAdmin: true, venue: null, email: 'backfill@alma.local' };

function monthsBetween(fromKey: string, toKey: string): Array<{ start: string; end: string; label: string }> {
  const [fy, fm] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  const months: Array<{ start: string; end: string; label: string }> = [];
  let year = fy!;
  let month = fm!;
  while (year < ty! || (year === ty! && month < tm!)) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    months.push({
      start: start.toISOString(),
      end: end.toISOString(),
      label: `${year}-${String(month).padStart(2, '0')}`
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

async function totalCents() {
  const row = await prisma.salesItemActualEntry.aggregate({ _sum: { netSalesCents: true } });
  return row._sum.netSalesCents ?? 0;
}

async function main() {
  const from = process.argv[2] ?? '2025-07';
  const to = process.argv[3] ?? '2026-08';
  const months = monthsBetween(from, to);
  const before = await totalCents();
  console.log(`Re-importing ${months.length} month(s), both Square accounts.`);
  console.log(`Stored item-sales total before: $${(before / 100).toLocaleString('en-AU')}\n`);

  /**
   * Import one window, and split it if Square capped the read.
   *
   * Square returns at most 1,000 orders per search. The busier account passes
   * that inside a calendar month, and a capped read silently leaves the tail of
   * the month on the old GST-inclusive figures — which is exactly the kind of
   * partial success that looks like success. Halving until it fits is the only
   * way to know the whole period was covered.
   */
  async function importWindow(
    label: string,
    account: 'primary' | 'secondary',
    start: string,
    end: string,
    depth = 0
  ): Promise<void> {
    const started = Date.now();
    const indent = '  '.repeat(depth + 1);
    let result: any;
    try {
      result = await integrationService.importSquareItemSales(
        // startDate/endDate, NOT start/end. The importer reads
        // `input.startDate` and silently falls back to a 7-day lookback when it
        // is absent, so passing start/end re-imported the same recent week
        // fourteen times and moved the stored total by 0.1%.
        { startDate: start, endDate: end, account, orderLimit: 1000 },
        actor
      );
    } catch (error) {
      console.log(`${indent}${label} ${account.padEnd(9)} FAILED — ${(error as Error).message}`);
      return;
    }

    console.log(
      `${indent}${label.padEnd(18)} ${account.padEnd(9)} ${String(result?.itemSalesRowsUpserted ?? '?').padStart(5)} rows  ` +
        `${String(result?.ordersRead ?? '?').padStart(5)} orders  ${String(Date.now() - started).padStart(6)}ms` +
        (result?.limited ? '  CAPPED — splitting' : '')
    );

    if (!result?.limited) return;
    // A single day that still caps cannot be split any further; say so rather
    // than recursing forever.
    const from = new Date(start).getTime();
    const to = new Date(end).getTime();
    if (to - from <= 24 * 60 * 60 * 1000) {
      console.log(`${indent}  ! ${label} still caps at one day — more than 1,000 orders in a day.`);
      return;
    }
    const mid = new Date(from + Math.floor((to - from) / 2)).toISOString();
    await importWindow(`${label} a`, account, start, mid, depth + 1);
    await importWindow(`${label} b`, account, mid, end, depth + 1);
  }

  for (const month of months) {
    for (const account of ['primary', 'secondary'] as const) {
      await importWindow(month.label, account, month.start, month.end);
    }
  }

  const after = await totalCents();
  console.log(`\nStored item-sales total after:  $${(after / 100).toLocaleString('en-AU')}`);
  console.log(`Change: $${((after - before) / 100).toLocaleString('en-AU')} (${(((after - before) / before) * 100).toFixed(1)}%)`);
  console.log('Expect roughly -9%: that is the GST coming back off.');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
