import { prisma } from '@alma/db';

// Archive HUMAN staff that are TERMINATED but never archived (they clutter the
// 376-long staff list). Archiving only hides them — fully reversible by setting
// employmentStatus back. DRY RUN by default; set ARCHIVE_CONFIRM=YES to apply.

const CONFIRM = process.env.ARCHIVE_CONFIRM === 'YES';

async function main() {
  const rows = await prisma.staffProfile.findMany({
    where: { accountType: 'HUMAN', employmentStatus: 'TERMINATED' },
    select: { id: true, firstName: true, lastName: true, venue: true }
  });
  console.log(`\n${rows.length} TERMINATED human staff to archive (employmentStatus → ARCHIVED).`);
  console.log('Archiving only hides them from the active register; nothing is deleted.');
  console.log('\nSample:');
  for (const r of rows.slice(0, 20)) console.log(`  ${r.firstName} ${r.lastName}${r.venue ? ` · ${r.venue}` : ''}`);
  if (rows.length > 20) console.log(`  …and ${rows.length - 20} more`);

  if (!CONFIRM) {
    console.log(`\nDRY RUN — nothing changed. To apply:`);
    console.log(`   ARCHIVE_CONFIRM=YES ./scripts/staff-archive-terminated.sh`);
    await prisma.$disconnect();
    return;
  }

  const res = await prisma.staffProfile.updateMany({
    where: { accountType: 'HUMAN', employmentStatus: 'TERMINATED' },
    data: { employmentStatus: 'ARCHIVED' }
  });
  console.log(`\n✅ Archived ${res.count} terminated staff. The register now shows only current/pending staff.`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
