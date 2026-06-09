import { prisma } from '@alma/db';

// Remove duplicate timesheets created by the Xero Payroll import that double up
// a shift already on file from Deputy or a manual entry. Mirrors the import's
// own de-dup rule exactly: a Xero-import row (xeroImportKey set) is a duplicate
// when another timesheet exists for the SAME staff member, SAME calendar day and
// SAME worked hours. We only ever delete Xero-import rows — never a Deputy or
// manually entered timesheet.
//
// SAFETY:
//  - DRY RUN by default — set DEDUPE_TIMESHEETS_CONFIRM=YES to delete.
//  - Only Xero-import rows (xeroImportKey != null) are ever deleted.
//  - A group of purely manual/Deputy duplicates (no Xero row) is left untouched
//    and reported, so we never silently remove a hand-entered shift.

const CONFIRM = process.env.DEDUPE_TIMESHEETS_CONFIRM === 'YES';

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function workedHours(inAt: Date | null, outAt: Date | null, breakMin: number | null): number | null {
  if (!inAt || !outAt) return null;
  return Math.round(((outAt.getTime() - inAt.getTime()) / 3_600_000 - (breakMin ?? 0) / 60) * 100) / 100;
}

async function main() {
  const rows = await prisma.timesheet.findMany({
    select: {
      id: true,
      staffProfileId: true,
      workDate: true,
      clockInAt: true,
      clockOutAt: true,
      breakMinutes: true,
      xeroImportKey: true,
      status: true,
      paymentMethod: true,
      createdAt: true
    },
    orderBy: { createdAt: 'asc' }
  });

  // Group by staff + day + worked hours. Rows missing clock times can't be
  // compared on hours, so they're never treated as duplicates.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const hrs = workedHours(r.clockInAt, r.clockOutAt, r.breakMinutes);
    if (hrs === null) continue;
    const key = `${r.staffProfileId}|${dayKey(r.workDate)}|${hrs}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const toDelete: typeof rows = [];
  const manualOnlyDupes: string[] = [];
  let xeroVsNonXeroGroups = 0;
  let xeroVsXeroGroups = 0;

  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const nonXero = list.filter((r) => !r.xeroImportKey);
    const xero = list.filter((r) => r.xeroImportKey);

    if (nonXero.length >= 1 && xero.length >= 1) {
      // A Deputy/manual copy exists → every Xero-import row here is a duplicate.
      xeroVsNonXeroGroups++;
      toDelete.push(...xero);
    } else if (nonXero.length === 0 && xero.length > 1) {
      // Only Xero rows, duplicated among themselves — keep the earliest, drop the rest.
      xeroVsXeroGroups++;
      toDelete.push(...xero.slice(1));
    } else if (xero.length === 0 && nonXero.length > 1) {
      // Purely manual/Deputy duplicates — NOT a Xero problem; leave them, just flag.
      manualOnlyDupes.push(key);
    }
  }

  console.log('— Timesheet de-dup —');
  console.log(`Total timesheets scanned: ${rows.length}`);
  console.log(`Duplicate groups: Xero-vs-(Deputy/manual)=${xeroVsNonXeroGroups}, Xero-vs-Xero=${xeroVsXeroGroups}`);
  console.log(`Xero-import duplicate rows to delete: ${toDelete.length}`);
  if (manualOnlyDupes.length) {
    console.log(
      `Note: ${manualOnlyDupes.length} group(s) of purely manual/Deputy duplicates were found and LEFT UNTOUCHED (review these by hand if needed).`
    );
  }

  // Breakdown by status so an already-exported duplicate is visible before delete.
  const byStatus = new Map<string, number>();
  for (const r of toDelete) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  if (toDelete.length) {
    console.log('To-delete by status: ' + [...byStatus].map(([s, n]) => `${s}=${n}`).join(', '));
  }

  if (!toDelete.length) {
    console.log('Nothing to delete. ✓');
    return;
  }

  if (!CONFIRM) {
    console.log('\nDRY RUN — no rows deleted. Re-run with DEDUPE_TIMESHEETS_CONFIRM=YES to apply.');
    return;
  }

  const result = await prisma.timesheet.deleteMany({ where: { id: { in: toDelete.map((r) => r.id) } } });
  console.log(`\nDeleted ${result.count} duplicate Xero-import timesheet(s). ✓`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
