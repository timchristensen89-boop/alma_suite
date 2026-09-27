// THE rule that puts a dollar of labour under a venue. Every report that
// shows wages by venue — the Monthly Recap, the Prime Cost report's rows and
// its group total, the forecast's trailing wage % — reads this one
// allocation, so a venue report and the group's row for that venue are the
// same number by construction.
//
// Before this existed, the group view attributed a timesheet with no venue
// to the worker's profile venue while the venue-scoped query filtered on
// the timesheet's own venue only: the group's Avalon row for July 2026 was
// $41,865.44 and the Avalon venue report $41,151.54 ($713.90 of null-venue
// timesheets); August St Alma differed by $856.80 the same way. Two
// populations for one metric.
//
// The allocation, per amount, is explicit and auditable:
//
//   • explicit   — the timesheet / shift names a configured venue (exact or
//                  an evidenced alias, @alma/shared venue-resolution);
//   • profile    — it names no venue, and the worker's profile venue is a
//                  configured venue. This is the domain's existing fallback
//                  (clock-out, Deputy import and admin labour all read
//                  `timesheet.venue ?? staffProfile.venue`), used here for
//                  every consumer alike and reported as the fallback it is;
//   • invalid    — the label that was written is not a configured venue
//                  ("Both", a person's name, a typo). The amount is kept,
//                  under that label, flagged. It is never guessed into a
//                  restaurant; it is in the group and in no venue;
//   • unassigned — no label anywhere. Kept, flagged, likewise.
//
// A roster estimate is carried on the same rows and never becomes actual
// labour (lib/labour-rows.ts).

import { resolveVenueLabel } from '@alma/shared';
import type { LabourRow, LabourVenueStatus } from './labour-rows.js';

export type LabourSource = 'explicit' | 'profile' | 'invalid' | 'unassigned';

export type LabourVenueKey = { key: string; status: LabourVenueStatus; source: LabourSource };

/** Where an amount goes, from the label on the record and the label on the profile. */
export function resolveLabourVenue(recordLabel: string | null | undefined, profileLabel: string | null | undefined, configuredVenues: string[]): LabourVenueKey {
  const record = recordLabel?.trim() || '';
  if (record) {
    const resolved = resolveVenueLabel(record, configuredVenues);
    if (resolved.venue) return { key: resolved.venue, status: 'configured', source: 'explicit' };
    // The record said something; it just is not a venue. Keep what it said.
    return { key: record, status: 'invalid', source: 'invalid' };
  }
  const profile = profileLabel?.trim() || '';
  if (profile) {
    const resolved = resolveVenueLabel(profile, configuredVenues);
    if (resolved.venue) return { key: resolved.venue, status: 'configured', source: 'profile' };
    return { key: profile, status: 'invalid', source: 'invalid' };
  }
  return { key: 'Unassigned', status: 'unassigned', source: 'unassigned' };
}

export type CostedTimesheet = {
  venueLabel: string | null | undefined;
  profileVenueLabel: string | null | undefined;
  cents: number;
  approved: boolean;
  hours: number;
};

export type CostedShift = {
  venueLabel: string | null | undefined;
  profileVenueLabel: string | null | undefined;
  cents: number;
  hours: number;
};

/** A salaried worker's elapsed-period cost, already split by rostered hours across venue KEYS (resolved with resolveLabourVenue). */
export type SalariedAllocation = { venueKey: LabourVenueKey; cents: number };

const emptyRow = (venue: LabourVenueKey): LabourRow => ({
  venue: venue.key,
  venueStatus: venue.status,
  wageCents: 0,
  explicitWageCents: 0,
  profileFallbackWageCents: 0,
  salariedWageCents: 0,
  approvedWageCents: 0,
  rosterWageEstimateCents: 0,
  timesheetHours: 0,
  rosterHours: 0
});

/**
 * The canonical rows for a period: every configured venue that has labour,
 * plus any invalid / unassigned keys the data holds. Σ rows = the group.
 */
export function allocateLabour(input: {
  configuredVenues: string[];
  timesheets: CostedTimesheet[];
  shifts: CostedShift[];
  salaried: SalariedAllocation[];
}): Map<string, LabourRow> {
  const rows = new Map<string, LabourRow>();
  const rowFor = (venue: LabourVenueKey) => {
    const row = rows.get(venue.key) ?? emptyRow(venue);
    rows.set(venue.key, row);
    return row;
  };
  for (const t of input.timesheets) {
    const venue = resolveLabourVenue(t.venueLabel, t.profileVenueLabel, input.configuredVenues);
    const row = rowFor(venue);
    row.wageCents += t.cents;
    row.timesheetHours += t.hours;
    if (t.approved) row.approvedWageCents += t.cents;
    if (venue.source === 'profile') row.profileFallbackWageCents += t.cents;
    else if (venue.source === 'explicit') row.explicitWageCents += t.cents;
  }
  for (const s of input.shifts) {
    const row = rowFor(resolveLabourVenue(s.venueLabel, s.profileVenueLabel, input.configuredVenues));
    row.rosterWageEstimateCents += s.cents;
    row.rosterHours += s.hours;
  }
  for (const s of input.salaried) {
    if (s.cents <= 0) continue;
    const row = rowFor(s.venueKey);
    row.wageCents += s.cents;
    row.approvedWageCents += s.cents;
    row.salariedWageCents += s.cents;
    row.rosterWageEstimateCents += s.cents;
  }
  return rows;
}

/** The one row a venue-scoped report may show: that venue's canonical allocation, or nothing. */
export function venueRow(rows: Map<string, LabourRow>, venue: string, configuredVenues: string[]): LabourRow | null {
  const resolved = resolveVenueLabel(venue, configuredVenues);
  const key = resolved.venue ?? venue.trim();
  return rows.get(key) ?? null;
}
