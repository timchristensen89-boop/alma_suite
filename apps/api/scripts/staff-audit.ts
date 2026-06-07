import { prisma } from '@alma/db';

const pad = (s: string, n: number) => (s + ' '.repeat(n)).slice(0, n);

async function main() {
  const all = await prisma.staffProfile.findMany({
    select: {
      id: true, firstName: true, lastName: true, email: true, venue: true,
      employmentStatus: true, accountType: true, mergedIntoStaffProfileId: true,
      payRateCents: true, notes: true, createdAt: true
    }
  });

  console.log(`\n=== StaffProfile TOTAL: ${all.length} ===`);

  const tally = (label: string, rows: typeof all) => {
    const byStatus = new Map<string, number>();
    for (const r of rows) byStatus.set(r.employmentStatus, (byStatus.get(r.employmentStatus) ?? 0) + 1);
    console.log(`\n${label} (${rows.length})`);
    for (const [s, n] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${pad(s, 14)} ${n}`);
  };

  tally('BY employmentStatus (all profiles)', all);

  // The Staff list = HUMAN, not ARCHIVED — this is what shows as "376".
  const listed = all.filter((r) => r.accountType === 'HUMAN' && r.employmentStatus !== 'ARCHIVED');
  console.log(`\n=== WHAT THE STAFF LIST SHOWS: HUMAN & not ARCHIVED = ${listed.length} ===`);
  tally('  ↳ by status', listed);
  console.log(`  with email:          ${listed.filter((r) => r.email).length}`);
  console.log(`  with a pay rate:     ${listed.filter((r) => r.payRateCents).length}`);
  console.log(`  Deputy-created:      ${listed.filter((r) => (r.notes ?? '').toLowerCase().includes('deputy')).length}`);
  console.log(`  "Unallocated" holder:${listed.filter((r) => r.firstName.toLowerCase().startsWith('unallocated')).length}`);
  console.log(`  merged-but-not-archived: ${listed.filter((r) => r.mergedIntoStaffProfileId).length}`);

  // Recent shift activity → distinguishes real current workers from stale rows.
  const since = new Date(Date.now() - 90 * 86_400_000);
  const recent = await prisma.timesheet.groupBy({ by: ['staffProfileId'], where: { workDate: { gte: since } } });
  const recentIds = new Set(recent.map((t) => t.staffProfileId));
  const active = listed.filter((r) => r.employmentStatus === 'ACTIVE');
  console.log(`\n=== ACTIVE (HUMAN) = ${active.length} ===`);
  console.log(`  worked a shift in last 90d:  ${active.filter((r) => recentIds.has(r.id)).length}  ← the genuinely-current crew`);
  console.log(`  NO shift in 90d:             ${active.filter((r) => !recentIds.has(r.id)).length}  ← likely stale / left / placeholder`);

  console.log('\n=== SAFE-TO-ARCHIVE CANDIDATES ===');
  const terminated = listed.filter((r) => r.employmentStatus === 'TERMINATED');
  const unalloc = listed.filter((r) => r.firstName.toLowerCase().startsWith('unallocated'));
  const staleNoShift = active.filter((r) => !recentIds.has(r.id) && !r.firstName.toLowerCase().startsWith('unallocated'));
  console.log(`  TERMINATED (not archived):           ${terminated.length}`);
  console.log(`  "Unallocated" placeholders:          ${unalloc.length}`);
  console.log(`  ACTIVE but no shift in 90d:           ${staleNoShift.length}  (review before archiving — could be office/salaried)`);
  console.log(`\n  → archiving TERMINATED + Unallocated alone removes ${terminated.length + unalloc.length} of the ${listed.length}.`);

  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
