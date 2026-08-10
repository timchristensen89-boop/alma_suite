import { Prisma, PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// ── Employment status guard ────────────────────────────────────────────────
// Tim's owner account was silently switched to TERMINATED three times, which
// locks him out of the POS (every PIN gate requires ACTIVE) and makes him
// look deleted. Twice it went untraced because NOTHING recorded who did it
// and any caller could set the field — `employmentStatus` is a free-form
// string on the shared update schema.
//
// This sits on the Prisma client because that is the one place every writer
// passes through: the staff API, the Deputy sync, a script, or whatever gets
// written next. It does two things:
//   1. RECORDS every transition, so a recurrence is diagnosable in seconds
//      instead of being guesswork.
//   2. REFUSES to deactivate an owner/admin who can sign in. Offboarding an
//      owner is a deliberate act, not something a routine profile save or a
//      roster import should ever do in passing.
// Ordinary staff — including managers — offboard exactly as before.
const PROTECTED_ROLE = /owner|admin|director|licensee/i;
const ACTIVE_STATUSES = new Set(['ACTIVE', 'ON_LEAVE']);

// An explicit, deliberate override for genuinely offboarding an owner.
export const FORCE_STATUS_CHANGE = '__alma_force_status_change__';

type StatusWrite = { employmentStatus?: unknown; [key: string]: unknown };

function isDeactivation(next: unknown): boolean {
  return typeof next === 'string' && !ACTIVE_STATUSES.has(next);
}

async function recordAndGuard(
  client: PrismaClient,
  where: Prisma.StaffProfileWhereUniqueInput | Prisma.StaffProfileWhereInput | undefined,
  data: StatusWrite
) {
  const next = data.employmentStatus;
  if (typeof next !== 'string' || !where) return;

  const affected = await client.staffProfile.findMany({
    where: where as Prisma.StaffProfileWhereInput,
    select: { id: true, firstName: true, lastName: true, roleTitle: true, employmentStatus: true, passwordHash: true }
  });

  for (const profile of affected) {
    if (profile.employmentStatus === next) continue;

    const protectedAccount =
      Boolean(profile.passwordHash) && PROTECTED_ROLE.test(profile.roleTitle ?? '');
    if (protectedAccount && isDeactivation(next) && data[FORCE_STATUS_CHANGE] !== true) {
      throw new Error(
        `Refusing to set ${profile.firstName} ${profile.lastName} (${profile.roleTitle}) to ${next}: ` +
          'that account owns the software and can sign in. Offboard it deliberately via the staff app ' +
          'if this is really intended.'
      );
    }

    // Best effort — an audit row must never break the write it describes.
    await client.staffStatusChange
      .create({
        data: {
          staffProfileId: profile.id,
          fromStatus: profile.employmentStatus,
          toStatus: next,
          source: (typeof data.__source === 'string' ? data.__source : null) ?? 'unknown',
          stack: new Error().stack?.split('\n').slice(2, 9).join('\n').slice(0, 2000) ?? null
        }
      })
      .catch(() => undefined);
  }
}

function buildClient(): PrismaClient {
  const base = new PrismaClient();
  return base.$extends({
    query: {
      staffProfile: {
        async update({ args, query }) {
          await recordAndGuard(base, args.where, args.data as StatusWrite);
          delete (args.data as StatusWrite)[FORCE_STATUS_CHANGE];
          delete (args.data as StatusWrite).__source;
          return query(args);
        },
        async updateMany({ args, query }) {
          await recordAndGuard(base, args.where, args.data as StatusWrite);
          delete (args.data as StatusWrite)[FORCE_STATUS_CHANGE];
          delete (args.data as StatusWrite).__source;
          return query(args);
        }
      }
    }
  }) as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? buildClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
