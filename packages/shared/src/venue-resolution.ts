// The one boundary between a venue-shaped string and a configured venue.
// Covered by venue-resolution.test.ts (apps/api/src/lib).
//
// Venue fields are filled from many places: the app's own pickers, the
// Loaded CSV/PDF importers (a "Location" column, or the first line of a
// print-out), Xero tenant names, compliance sheets. Some of what arrives is
// a real venue with harmless formatting differences ("st alma", "ST ALMA ");
// some is a known alias with explicit evidence behind it; some is a marker
// that means "not one venue" ("Both", "All venues"); and some is a label
// nobody can place ("St View", "Unspecified", a Loaded location name).
//
// The rules:
//   1. harmless formatting differences are normalised (case, whitespace,
//      punctuation);
//   2. only EXPLICIT aliases resolve, each with its evidence recorded below;
//   3. the result is the configured venue's canonical name, never the label;
//   4. an unknown label stays unknown — nothing is guessed from similarity;
//   5. the original label is always returned so it can be remediated.
//
// An unknown venue is unattributed data, not a new restaurant.

import { isPseudoVenue } from './venue-names.js';

export type VenueResolutionStatus =
  /** Exactly a configured venue, after normalisation. */
  | 'canonical'
  /** A supported alias with explicit evidence. */
  | 'alias'
  /** A marker meaning "not one venue" (Both, All venues …). */
  | 'pseudo'
  /** Empty. */
  | 'blank'
  /** A label nobody can place; stays unattributed. */
  | 'unknown';

export type VenueResolution = {
  /** The configured venue's canonical name, or null when unattributed. */
  venue: string | null;
  status: VenueResolutionStatus;
  /** What actually arrived, untouched, for remediation. */
  sourceLabel: string;
};

/** Case, whitespace and punctuation-insensitive form used for matching. */
export function normaliseVenueLabel(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Explicit aliases, keyed by normalised label, each with its evidence. Add a
 * row only with evidence that the label means that venue; a label that only
 * LOOKS like a venue is not evidence.
 *
 *  - "alma freshwater pty ltd" / "freshwater": the St Alma legal entity and
 *    suburb (the Xero tenant mapping in integration.service has carried this
 *    since the Xero bill import was built; St Alma trades in Freshwater).
 *  - "alma avalon pty ltd" / "avalon": the Alma Avalon entity and suburb,
 *    same source.
 *  - "st. alma", "st alma freshwater": punctuation/suburb variants of the
 *    configured name seen on menus and the gift-card site.
 */
export const VENUE_ALIASES: ReadonlyArray<{ label: string; venue: string; evidence: string }> = [
  { label: 'st alma', venue: 'St Alma', evidence: 'configured name' },
  { label: 'st alma freshwater', venue: 'St Alma', evidence: 'suburb suffix used on the gift-card site' },
  { label: 'alma freshwater pty ltd', venue: 'St Alma', evidence: 'Xero tenant (legal entity) mapping in integration.service' },
  { label: 'alma freshwater', venue: 'St Alma', evidence: 'Xero tenant (legal entity) mapping in integration.service' },
  { label: 'freshwater', venue: 'St Alma', evidence: 'Xero tenant keyword mapping in integration.service' },
  { label: 'alma avalon pty ltd', venue: 'Alma Avalon', evidence: 'Xero tenant (legal entity) mapping in integration.service' },
  { label: 'avalon', venue: 'Alma Avalon', evidence: 'Xero tenant keyword mapping in integration.service' }
];

/** Labels that are known NOT to identify one venue, beyond the pseudo markers. */
const UNATTRIBUTED_LABELS = new Set(['unspecified', 'unknown', 'unassigned', 'n a', 'na', 'none', 'venue']);

export function resolveVenueLabel(
  label: string | null | undefined,
  configuredVenues: ReadonlyArray<string>,
  aliases: ReadonlyArray<{ label: string; venue: string }> = VENUE_ALIASES
): VenueResolution {
  const sourceLabel = (label ?? '').trim();
  const key = normaliseVenueLabel(sourceLabel);
  if (!key) return { venue: null, status: 'blank', sourceLabel };
  if (isPseudoVenue(sourceLabel)) return { venue: null, status: 'pseudo', sourceLabel };
  if (UNATTRIBUTED_LABELS.has(key)) return { venue: null, status: 'unknown', sourceLabel };

  const configured = configuredVenues.find((venue) => normaliseVenueLabel(venue) === key);
  if (configured) return { venue: configured, status: 'canonical', sourceLabel };

  const alias = aliases.find((row) => normaliseVenueLabel(row.label) === key);
  if (alias) {
    // An alias only resolves to a venue that is actually configured; an
    // alias for a venue that no longer exists is unknown, not invented.
    const target = configuredVenues.find((venue) => normaliseVenueLabel(venue) === normaliseVenueLabel(alias.venue));
    if (target) return { venue: target, status: 'alias', sourceLabel };
  }
  return { venue: null, status: 'unknown', sourceLabel };
}

/** True when the label resolves to a configured venue (canonical or alias). */
export function isConfiguredVenueLabel(label: string | null | undefined, configuredVenues: ReadonlyArray<string>): boolean {
  return resolveVenueLabel(label, configuredVenues).venue != null;
}
