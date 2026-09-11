import type { AuthUser } from '@alma/shared';
import type { Prisma } from '@prisma/client';

/**
 * Who may manage whom.
 *
 * People management is group-wide. Alma Freshwater and Alma Avalon are two
 * companies with two payrolls, but one team runs them: a manager based at
 * St Alma onboards a new hire onto Alma Avalon, sees them through to
 * approval and pushes them to the right payroll, exactly as they would for a
 * hire at their own venue. A manager's venue is where they are based — it is
 * not a fence around the people they can reach.
 *
 * What a manager may SEE on a profile is a separate question, answered by
 * their HR permissions (redactStaffProfileFields): reaching a profile at the
 * other venue shows no pay, bank or tax detail to anyone who couldn't see it
 * at their own.
 *
 * Operational scope — rostering, timesheets, clocking, venue devices — is
 * still per venue and is decided where those live.
 */

export type StaffReachActor = Pick<AuthUser, 'id' | 'role' | 'isAdmin'>;

export function isAdminActor(actor: StaffReachActor): boolean {
  return actor.isAdmin || actor.role === 'ADMIN';
}

/**
 * Why this actor may not act on this staff profile, or null when they may.
 * Admins and managers reach every profile; a staff member reaches only
 * their own.
 */
export function staffProfileAccessDenial(actor: StaffReachActor, staffProfileId: string): string | null {
  if (isAdminActor(actor)) return null;
  if (actor.role === 'STAFF' && actor.id !== staffProfileId) {
    return 'You can only access your own staff profile.';
  }
  return null;
}

/**
 * The filter that keeps a people list inside what this actor may reach.
 * Spread it into a StaffProfile `where`.
 */
export function staffProfileReach(actor?: StaffReachActor | null): Prisma.StaffProfileWhereInput {
  if (!actor || isAdminActor(actor)) return {};
  if (actor.role === 'STAFF') return { id: actor.id };
  return {};
}
