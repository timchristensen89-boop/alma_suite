// One labour population for every report that shows wages.
//
// The Monthly Recap and the Prime Cost report both cost the same timesheets
// and the same salaried staff, but the Prime Cost report also builds a
// roster estimate per venue row and, per row, used `wageCents ||
// rosterWageEstimateCents`. A row with no timesheets at all — August 2026's
// "Both" row, one 5.5-hour rostered shift worth $193.22 and nothing clocked
// under that label — was
// therefore counted at its roster estimate, and the report's total, labelled
// "timesheets", carried $85,800.45 against the Recap's $85,607.23.
//
// The rule here: a total is the sum of ACTUAL labour (timesheet hours ×
// rates + the salaried share) and nothing else. A row with only a roster
// estimate is shown with that estimate and its basis, and the total says
// how much roster-only labour it left out. Both reports read the same rows,
// allocated to venues by lib/labour-allocation.ts.

import type { LabourBasis } from '@alma/shared';

/** configured = a real venue; invalid = a label that is not one ("Both", a name); unassigned = no label at all. */
export type LabourVenueStatus = 'configured' | 'invalid' | 'unassigned';

export type LabourRow = {
  venue: string;
  venueStatus: LabourVenueStatus;
  /** Timesheet hours × rates + the salaried share: actual labour. */
  wageCents: number;
  /** Of wageCents: timesheets that named this venue themselves. */
  explicitWageCents: number;
  /** Of wageCents: timesheets with no venue, placed here by the worker's profile venue. */
  profileFallbackWageCents: number;
  /** Of wageCents: the salaried elapsed-period share allocated here. */
  salariedWageCents: number;
  approvedWageCents: number;
  rosterWageEstimateCents: number;
  timesheetHours: number;
  rosterHours: number;
};

/** What one row shows as its labour figure, and on what basis. */
export function labourFigure(row: Pick<LabourRow, 'wageCents' | 'rosterWageEstimateCents'>): { cents: number; basis: LabourBasis } {
  if (row.wageCents > 0) return { cents: row.wageCents, basis: 'timesheets' };
  if (row.rosterWageEstimateCents > 0) return { cents: row.rosterWageEstimateCents, basis: 'roster_estimate' };
  return { cents: 0, basis: 'missing' };
}

export type LabourTotal = {
  /** Σ actual labour over the rows. Never includes a roster estimate. */
  wageCents: number;
  approvedWageCents: number;
  rosterWageEstimateCents: number;
  timesheetHours: number;
  rosterHours: number;
  basis: LabourBasis;
  /** Rows that carry only a roster estimate, and how much; excluded from wageCents. */
  rosterOnlyVenues: string[];
  rosterOnlyEstimateCents: number;
  /** Actual labour under labels that are not configured venues, or under no label: in the group, in no venue. */
  unallocatedWageCents: number;
  unallocatedVenues: string[];
  /** Actual labour placed by the profile-venue fallback, across all rows. */
  profileFallbackWageCents: number;
};

export function labourTotal(rows: Iterable<LabourRow>): LabourTotal {
  const total: LabourTotal = {
    wageCents: 0,
    approvedWageCents: 0,
    rosterWageEstimateCents: 0,
    timesheetHours: 0,
    rosterHours: 0,
    basis: 'missing',
    rosterOnlyVenues: [],
    rosterOnlyEstimateCents: 0,
    unallocatedWageCents: 0,
    unallocatedVenues: [],
    profileFallbackWageCents: 0
  };
  for (const row of rows) {
    total.wageCents += row.wageCents;
    total.approvedWageCents += row.approvedWageCents;
    total.rosterWageEstimateCents += row.rosterWageEstimateCents;
    total.timesheetHours += row.timesheetHours;
    total.rosterHours += row.rosterHours;
    total.profileFallbackWageCents += row.profileFallbackWageCents;
    if (row.venueStatus !== 'configured' && row.wageCents > 0) {
      total.unallocatedVenues.push(row.venue);
      total.unallocatedWageCents += row.wageCents;
    }
    if (row.wageCents <= 0 && row.rosterWageEstimateCents > 0) {
      total.rosterOnlyVenues.push(row.venue);
      total.rosterOnlyEstimateCents += row.rosterWageEstimateCents;
    }
  }
  total.basis = total.wageCents > 0 ? 'timesheets' : total.rosterWageEstimateCents > 0 ? 'roster_estimate' : 'missing';
  return total;
}
