import type { AuthUser } from '@alma/shared';

/**
 * "Both" is not a venue.
 *
 * A staff profile's `venue` names where that person works, and for anyone who
 * works across the group it is the literal string `'Both'` — the same marker
 * the compliance imports use (`packages/shared/src/complianceImports.ts`).
 * The configured venues are the two in `AppSettings.venues`: "Alma Avalon" and
 * "St Alma". Nothing is ever stored against a venue called "Both".
 *
 * Every venue guard in this API used to compare `requestedVenue === actor.venue`
 * with no knowledge of that marker, so the four group managers (the two venue
 * managers, the team leader, and the FOH manager who runs the counts) were
 * scoped to a venue that does not exist. Measured before this fix, on a clone
 * of production:
 *
 *   • creating a count for a real venue → 403 "limited to your venue"
 *   • creating one with the venue left blank → saved with `venue: 'Both'`,
 *     which `stockValueAtCents` then treats as a THIRD venue and adds on top
 *     of the two real ones
 *   • the stocktake list showed 1 of 29 counts
 *   • the dashboard's venue picker offered exactly one option, "Both", and
 *     read 0 items on hand (no VenueStockItem rows carry that venue)
 *
 * So: an actor marked "Both" is venue-*unscoped*, the same as an admin, rather
 * than scoped to a venue nobody stocks. This says nothing about their
 * permissions — it is only about which venues they may see and act on.
 */
export const ALL_VENUES_MARKER = 'Both';

export function isAllVenuesActor(actor?: AuthUser | null) {
  return (actor?.venue ?? '').trim().toLowerCase() === ALL_VENUES_MARKER.toLowerCase();
}

/** True when the actor may see and act on every venue. */
export function isVenueUnscopedActor(actor?: AuthUser | null) {
  return Boolean(actor?.isAdmin || actor?.role === 'ADMIN' || isAllVenuesActor(actor));
}

/**
 * The venue this actor is pinned to, or null when they span every venue.
 * Use in place of a bare `actor.venue` read anywhere the value is used to
 * filter or to stamp a record.
 */
export function actorPinnedVenue(actor?: AuthUser | null): string | null {
  if (isVenueUnscopedActor(actor)) return null;
  const venue = (actor?.venue ?? '').trim();
  return venue || null;
}
