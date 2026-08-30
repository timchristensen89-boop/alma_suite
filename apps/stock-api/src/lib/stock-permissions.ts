import type { AuthUser } from '@alma/shared';
import { HttpError } from './http.js';

export function isStockManager(user: AuthUser | null | undefined): boolean {
  return Boolean(user && (user.isAdmin || user.role === 'ADMIN' || user.role === 'MANAGER'));
}

export function requireStockManager(user: AuthUser | undefined) {
  if (!user) throw new HttpError(401, 'Not authenticated');
  if (!isStockManager(user)) {
    throw new HttpError(403, 'Manager access required');
  }
}

/**
 * Any signed-in stock user. Use this only where the service itself narrows
 * what a non-manager may do — counting lines on an open stocktake is the one
 * such path today; everything else on the stocktake router stays manager-only.
 */
export function requireStockUser(user: AuthUser | undefined) {
  if (!user) throw new HttpError(401, 'Not authenticated');
}

/**
 * The states a stocktake is still being counted in. Once it is SUBMITTED it
 * belongs to the reviewer; a manager reopens it (REOPENED) to hand it back.
 */
const OPEN_FOR_COUNTING = new Set(['IN_PROGRESS', 'REOPENED']);

/**
 * May this non-manager write counts to this stocktake?
 *
 * Staff count the shelves; managers own the count's identity and its state
 * machine. So a non-manager may write to a stocktake that is open for
 * counting and has not been applied to stock, and may not move it to another
 * status. Throws with the reason if not; returns nothing if so.
 *
 * Managers skip this entirely — call it only when isStockManager is false.
 */
export function assertMayEnterCounts(
  existing: { status: string; appliedAt: Date | null },
  requestedStatus: string | undefined
): void {
  if (existing.appliedAt) {
    throw new HttpError(403, 'This count has been applied to stock. Manager access required.');
  }
  if (!OPEN_FOR_COUNTING.has(existing.status)) {
    throw new HttpError(403, 'This count is closed for counting. Ask a manager to reopen it.');
  }
  if (requestedStatus !== undefined && requestedStatus !== existing.status) {
    throw new HttpError(403, 'Manager access required to submit or reopen a count.');
  }
}
