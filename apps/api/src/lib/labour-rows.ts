// One labour population for every report that shows wages.
//
// The Monthly Recap and the Prime Cost report both cost the same timesheets
// and the same salaried staff, but the Prime Cost report also builds a
// roster estimate per venue row and, per row, used `wageCents ||
// rosterWageEstimateCents`. A row with no timesheets at all — August 2026's
// "Unassigned" row, $193.22 of rostered shifts and nothing clocked — was
// therefore counted at its roster estimate, and the report's total, labelled
// "timesheets", carried $85,800.45 against the Recap's $85,607.23.
//
// The rule here: a total is the sum of ACTUAL labour (timesheet hours ×
// rates + the salaried share) and nothing else. A row with only a roster
// estimate is shown with that estimate and its basis, and the total says
// how much roster-only labour it left out. Both reports read the same rows.

import type { LabourBasis } from '@alma/shared';

export type LabourRow = {
  venue: string;
  /** Timesheet hours × rates + the salaried share: actual labour. */
  wageCents: number;
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
    rosterOnlyEstimateCents: 0
  };
  for (const row of rows) {
    total.wageCents += row.wageCents;
    total.approvedWageCents += row.approvedWageCents;
    total.rosterWageEstimateCents += row.rosterWageEstimateCents;
    total.timesheetHours += row.timesheetHours;
    total.rosterHours += row.rosterHours;
    if (row.wageCents <= 0 && row.rosterWageEstimateCents > 0) {
      total.rosterOnlyVenues.push(row.venue);
      total.rosterOnlyEstimateCents += row.rosterWageEstimateCents;
    }
  }
  total.basis = total.wageCents > 0 ? 'timesheets' : total.rosterWageEstimateCents > 0 ? 'roster_estimate' : 'missing';
  return total;
}
