/**
 * Markers that live in venue-shaped fields but are not venues.
 *
 * Staff who work across the group carry `venue: 'Both'`; a few seeds and
 * forms wrote "Both venues", "Either venue" or "All venues" into the same
 * fields. Pickers that build their options from stored venue values must not
 * offer these as places, and nothing should ever be filtered TO them.
 */
export const PSEUDO_VENUE_MARKERS = ['Both', 'Both venues', 'Either venue', 'All venues'] as const;

export function isPseudoVenue(value: string | null | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim().toLowerCase();
  return PSEUDO_VENUE_MARKERS.some((marker) => marker.toLowerCase() === trimmed);
}

/** The real venue names among a list of stored venue values, de-duplicated and sorted. */
export function realVenueNames(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value) && !isPseudoVenue(value)))).sort((a, b) =>
    a.localeCompare(b)
  );
}
