/**
 * Merge a known duplicate staff profile into the surviving one.
 *
 *   node --import tsx scripts/merge-duplicate-profiles.ts <keepId> <duplicateId>
 *
 * Goes through staffService.mergeDuplicateStaff so the audit trail, management
 * events and guards are identical to doing it in the app.
 */
import { prisma } from '@alma/db';
import { staffService } from '../src/services/staff.service.js';
import type { AuthUser } from '@alma/shared';

const [keepId, duplicateId] = process.argv.slice(2);
if (!keepId || !duplicateId) {
  console.error('Usage: merge-duplicate-profiles.ts <keepId> <duplicateId>');
  process.exit(1);
}

const admin = await prisma.staffProfile.findFirst({
  where: { isAdmin: true, mergedIntoStaffProfileId: null },
  select: { id: true, firstName: true, lastName: true, venue: true }
});
if (!admin) { console.error('no admin profile to act as'); process.exit(1); }

const actor = { id: admin.id, role: 'ADMIN', isAdmin: true, venue: admin.venue } as unknown as AuthUser;
const result = await staffService.mergeDuplicateStaff(
  { canonicalStaffProfileId: keepId, duplicateStaffProfileIds: [duplicateId], confirmation: 'MERGE STAFF' },
  actor
);
console.log(JSON.stringify(result, null, 1));
process.exit(0);
