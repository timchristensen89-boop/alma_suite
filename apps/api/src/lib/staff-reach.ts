import type { AuthUser } from '@alma/shared';
import type { Prisma } from '@prisma/client';

/**
 * Who may manage whom, and where.
 *
 * Managers work group-wide. Alma Freshwater and Alma Avalon are two
 * companies with two payrolls, but one team runs them: a manager based at
 * St Alma onboards a new hire onto Alma Avalon, approves them, rosters them,
 * signs off their timesheets and pushes them to the right payroll, exactly
 * as they would at their own venue. A manager's venue is where they are
 * based — it is not a fence around the people or the venues they can reach.
 * Where a query takes a venue, that venue is a filter the manager chose, and
 * no venue means every venue.
 *
 * Staff members are scoped to themselves and to their own venue: their own
 * profile, their own shifts and timesheets, their venue's open shifts.
 *
 * What a manager may SEE on a profile is a separate question, answered by
 * their HR permissions (redactStaffProfileFields): reaching a profile at the
 * other venue shows no pay, bank or tax detail to anyone who couldn't see it
 * at their own.
 */

export type StaffReachActor = Pick<AuthUser, 'id' | 'role' | 'isAdmin'>;

export function isAdminActor(actor: StaffReachActor): boolean {
  return actor.isAdmin || actor.role === 'ADMIN';
}

/** Admins and managers work across every venue; a staff member does not. */
export function reachesEveryVenue(actor: StaffReachActor): boolean {
  return isAdminActor(actor) || actor.role === 'MANAGER';
}

/**
 * Why this actor may not act on this staff profile, or null when they may.
 * Admins and managers reach every profile; a staff member reaches only
 * their own.
 */
export function staffProfileAccessDenial(actor: StaffReachActor, staffProfileId: string): string | null {
  if (reachesEveryVenue(actor)) return null;
  if (actor.id !== staffProfileId) {
    return 'You can only access your own staff profile.';
  }
  return null;
}

/**
 * The filter that keeps a people list inside what this actor may reach.
 * Spread it into a StaffProfile `where`.
 */
export function staffProfileReach(actor?: StaffReachActor | null): Prisma.StaffProfileWhereInput {
  if (!actor || reachesEveryVenue(actor)) return {};
  return { id: actor.id };
}
