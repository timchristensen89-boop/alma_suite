import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { labourFigure, labourTotal, type LabourRow } from './labour-rows.js';

const row = (venue: string, wageCents: number, rosterWageEstimateCents: number): LabourRow => ({
  venue,
  wageCents,
  approvedWageCents: wageCents,
  rosterWageEstimateCents,
  timesheetHours: wageCents > 0 ? 100 : 0,
  rosterHours: rosterWageEstimateCents > 0 ? 100 : 0
});

describe('the $193.22: a roster-only row never enters a total labelled timesheets', () => {
  // August 2026 group, from the real-data validation: Avalon $31,052.46 and
  // St Alma $53,697.97 from timesheets (the venue rows agree in both
  // reports), $856.80 of actual labour under no configured venue, and a row
  // with no timesheets at all and $193.22 of rostered shifts. The Prime Cost
  // report's per-row `wageCents || rosterWageEstimateCents` put the $193.22
  // into a total labelled "timesheets"; the Monthly Recap, summing actuals,
  // did not. (The validation script now prints each row's basis so the
  // re-run names the row.)
  const august = [
    row('Alma Avalon', 3_105_246, 3_000_000),
    row('St Alma', 5_369_797, 5_100_000),
    row('Unassigned', 85_680, 0),
    row('Either venue', 0, 19_322)
  ];

  it('the total is the sum of actual labour: $85,607.23, not $85,800.45', () => {
    const total = labourTotal(august);
    assert.equal(total.wageCents, 8_560_723);
    assert.equal(total.basis, 'timesheets');
    assert.deepEqual(total.rosterOnlyVenues, ['Either venue']);
    assert.equal(total.rosterOnlyEstimateCents, 19_322);
  });

  it('the row itself still shows its estimate, on its own basis', () => {
    assert.deepEqual(labourFigure(august[3]!), { cents: 19_322, basis: 'roster_estimate' });
    assert.deepEqual(labourFigure(august[0]!), { cents: 3_105_246, basis: 'timesheets' });
  });

  it('the Recap figure (Σ actual) and the Prime total are the same number from the same rows', () => {
    const recapWageCents = august.reduce((sum, r) => sum + r.wageCents, 0);
    assert.equal(labourTotal(august).wageCents, recapWageCents);
  });

  it('with no timesheets anywhere, the total is a roster estimate and says so', () => {
    const total = labourTotal([row('Alma Avalon', 0, 1_000), row('St Alma', 0, 2_000)]);
    assert.equal(total.wageCents, 0);
    assert.equal(total.basis, 'roster_estimate');
    assert.equal(total.rosterOnlyEstimateCents, 3_000);
  });

  it('nothing to cost is missing, not zero labour', () => {
    assert.equal(labourTotal([row('Alma Avalon', 0, 0)]).basis, 'missing');
    assert.deepEqual(labourFigure(row('x', 0, 0)), { cents: 0, basis: 'missing' });
  });
});
