/**
 * Bring every current staff member up to the standard access set.
 *
 * New hires now get Staff, Compliance and Gift Cards from the defaults in
 * staffService (and Stock when they work in the kitchen). The people already
 * on the books were created under the old default — the Staff app alone —
 * which is why a floor staffer could not log a fault or redeem a card
 * without a manager. This walks the register and adds what is missing.
 *
 * It is idempotent and conservative:
 *   - a row that does not exist is created (ENABLED, role USER)
 *   - an ENABLED row keeps its role; only the missing permission keys are
 *     added (a MANAGER row stays a MANAGER row)
 *   - a DISABLED or PENDING row is left alone and reported, because someone
 *     may have turned it off on purpose — pass --enable-disabled to flip
 *     those to ENABLED as well
 *   - archived, terminated and merged profiles are never touched
 *   - venue devices get the `giftcardsRedeem` spelling added to their Gift
 *     Cards row, so a PIN'd staffer's grant survives the device intersection
 *
 * Kitchen is read from the role title and the default roster area
 * (isKitchenRole in @alma/shared): chef, cook, kitchen, pastry, dish, KP,
 * prep, sous, commis, or default area "Kitchen".
 *
 * Dry run (default) prints the plan and writes nothing:
 *
 *   node --import tsx scripts/backfill-staff-access.ts
 *
 * Apply:
 *
 *   node --import tsx scripts/backfill-staff-access.ts --apply
 *   node --import tsx scripts/backfill-staff-access.ts --apply --enable-disabled
 *
 * On the VPS it runs inside the API container, which has DATABASE_URL:
 *
 *   docker compose exec -T suite-api sh -c "cd /workspace/apps/api && node --import tsx scripts/backfill-staff-access.ts"
 */
import { prisma } from '@alma/db';
import { isKitchenRole } from '@alma/shared';

const APPLY = process.argv.includes('--apply');
const ENABLE_DISABLED = process.argv.includes('--enable-disabled');

type AppId = 'STAFF' | 'COMPLIANCE' | 'GIFTCARDS' | 'STOCK';

// Mirrors STANDARD_STAFF_ACCESS and defaultStaffAppAccessCreateData in
// apps/api/src/services/staff.service.ts. Kept literal here so the script
// reads on its own.
const STANDARD: Array<{ appId: AppId; permissions: Record<string, true> }> = [
  { appId: 'STAFF', permissions: { staffSelfView: true, timesheetsSubmit: true, tipsViewOwn: true, chatTeam: true } },
  { appId: 'COMPLIANCE', permissions: { view: true, issuesCreate: true, checklistsRun: true } },
  { appId: 'GIFTCARDS', permissions: { view: true, redeem: true, giftcardsRedeem: true } }
];
const KITCHEN: { appId: AppId; permissions: Record<string, true> } = {
  appId: 'STOCK',
  permissions: { view: true, stockCount: true, stocktake: true }
};
const NOTE = 'Standard staff access (backfill).';

type Change =
  | { kind: 'create'; who: string; staffProfileId: string; appId: AppId; permissions: Record<string, boolean> }
  | { kind: 'merge'; who: string; appId: AppId; rowId: string; permissions: Record<string, boolean>; added: string[]; enable: boolean }
  | { kind: 'skip-disabled'; who: string; appId: AppId; status: string };

function permissionsOf(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, allowed]) => typeof allowed === 'boolean')
  ) as Record<string, boolean>;
}

async function main() {
  const people = await prisma.staffProfile.findMany({
    where: {
      accountType: 'HUMAN',
      mergedIntoStaffProfileId: null,
      employmentStatus: { in: ['ACTIVE', 'ON_LEAVE', 'PENDING'] }
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      roleTitle: true,
      defaultArea: true,
      employmentStatus: true,
      appAccess: { select: { id: true, appId: true, status: true, role: true, permissions: true } }
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
  });

  const changes: Change[] = [];
  let kitchenCount = 0;

  for (const person of people) {
    const who = `${person.firstName} ${person.lastName}`.trim() || person.id;
    const kitchen = isKitchenRole({ roleTitle: person.roleTitle, defaultArea: person.defaultArea });
    if (kitchen) kitchenCount += 1;
    const grants = kitchen ? [...STANDARD, KITCHEN] : STANDARD;

    for (const grant of grants) {
      const existing = person.appAccess.find((row) => row.appId === grant.appId);
      if (!existing) {
        changes.push({ kind: 'create', who, staffProfileId: person.id, appId: grant.appId, permissions: { ...grant.permissions } });
        continue;
      }
      const current = permissionsOf(existing.permissions);
      const added = Object.keys(grant.permissions).filter((key) => current[key] !== true);
      const enable = existing.status !== 'ENABLED';
      if (enable && !ENABLE_DISABLED) {
        changes.push({ kind: 'skip-disabled', who, appId: grant.appId, status: existing.status });
        continue;
      }
      if (added.length === 0 && !enable) continue;
      changes.push({
        kind: 'merge',
        who,
        appId: grant.appId,
        rowId: existing.id,
        permissions: { ...current, ...grant.permissions },
        added,
        enable
      });
    }
  }

  // Venue devices: the intersection in auth.service keeps only the
  // permission keys present on BOTH the staff row and the device row, so the
  // device needs the editor's spelling of the redeem grant too.
  const devices = await prisma.staffProfile.findMany({
    where: { accountType: 'VENUE_DEVICE' },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      appAccess: { select: { id: true, appId: true, status: true, role: true, permissions: true }, where: { appId: 'GIFTCARDS' } }
    }
  });
  for (const device of devices) {
    const who = `${device.firstName} ${device.lastName}`.trim() || device.id;
    const row = device.appAccess[0];
    if (!row) continue;
    const current = permissionsOf(row.permissions);
    if (current.giftcardsRedeem === true) continue;
    changes.push({
      kind: 'merge',
      who: `${who} (device)`,
      appId: 'GIFTCARDS',
      rowId: row.id,
      permissions: { ...current, redeem: true, giftcardsRedeem: true },
      added: ['giftcardsRedeem'].concat(current.redeem === true ? [] : ['redeem']),
      enable: false
    });
  }

  console.log(`${people.length} current staff, ${kitchenCount} in the kitchen, ${devices.length} venue devices.`);
  const creates = changes.filter((c) => c.kind === 'create');
  const merges = changes.filter((c) => c.kind === 'merge');
  const skipped = changes.filter((c) => c.kind === 'skip-disabled');
  for (const change of changes) {
    if (change.kind === 'create') console.log(`  + ${change.who}: add ${change.appId} (${Object.keys(change.permissions).join(', ')})`);
    else if (change.kind === 'merge') console.log(`  ~ ${change.who}: ${change.appId}${change.enable ? ' ENABLE' : ''}${change.added.length ? ` +${change.added.join(', ')}` : ''}`);
    else console.log(`  ! ${change.who}: ${change.appId} is ${change.status} — left alone (pass --enable-disabled to turn it on)`);
  }
  console.log(`\n${creates.length} rows to create, ${merges.length} rows to update, ${skipped.length} left disabled.`);

  if (!APPLY) {
    console.log('Dry run — nothing written. Re-run with --apply to make these changes.');
    return;
  }
  if (creates.length === 0 && merges.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const change of changes) {
      if (change.kind === 'create') {
        await tx.staffAppAccess.create({
          data: { staffProfileId: change.staffProfileId, appId: change.appId, status: 'ENABLED', role: 'USER', permissions: change.permissions, notes: NOTE }
        });
      } else if (change.kind === 'merge') {
        await tx.staffAppAccess.update({
          where: { id: change.rowId },
          data: { permissions: change.permissions, ...(change.enable ? { status: 'ENABLED' } : {}) }
        });
      }
    }
  });
  console.log(`Applied: ${creates.length} created, ${merges.length} updated.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
