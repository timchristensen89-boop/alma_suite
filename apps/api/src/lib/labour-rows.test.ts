import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { labourFigure, labourTotal, type LabourRow } from './labour-rows.js';

const row = (venue: string, wageCents: number, rosterWageEstimateCents: number, venueStatus: LabourRow['venueStatus'] = 'configured'): LabourRow => ({
  venue,
  venueStatus,
  wageCents,
  explicitWageCents: wageCents,
  profileFallbackWageCents: 0,
  salariedWageCents: 0,
  approvedWageCents: wageCents,
  rosterWageEstimateCents,
  timesheetHours: wageCents > 0 ? 100 : 0,
  rosterHours: rosterWageEstimateCents > 0 ? 100 : 0
});

describe('the $193.22: a roster-only row never enters a total labelled timesheets', () => {
  // August 2026 group, as the same-dump re-run printed it: Avalon
  // $31,052.46 and St Alma $54,554.77 from timesheets, and a row keyed
  // "Both" (the pseudo-venue a profile can carry) with no timesheets and one
  // 5.5-hour rostered shift worth $193.22. The Prime Cost report's per-row
  // `wageCents || rosterWageEstimateCents` put the $193.22 into a total
  // labelled "timesheets" ($85,800.45); the Monthly Recap, summing actuals,
  // read $85,607.23.
  const august = [
    row('Alma Avalon', 3_105_246, 3_203_839),
    row('St Alma', 5_455_477, 5_506_714),
    row('Both', 0, 19_322, 'invalid')
  ];

  it('the total is the sum of actual labour: $85,607.23, not $85,800.45', () => {
    const total = labourTotal(august);
    assert.equal(total.wageCents, 8_560_723);
    assert.equal(total.basis, 'timesheets');
    assert.deepEqual(total.rosterOnlyVenues, ['Both']);
    // A roster-only row is not actual labour, so it is not "unallocated" labour either.
    assert.equal(total.unallocatedWageCents, 0);
    assert.equal(total.rosterOnlyEstimateCents, 19_322);
  });

  it('the row itself still shows its estimate, on its own basis', () => {
    assert.deepEqual(labourFigure(august[2]!), { cents: 19_322, basis: 'roster_estimate' });
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

describe('actual labour under a label that is not a venue stays in the group and is named', () => {
  it('June 2026: $7,880.14 of salaried cost under "Both" is unallocated, not dropped and not guessed', () => {
    const total = labourTotal([row('Alma Avalon', 3_139_107, 0), row('Both', 788_014, 0, 'invalid'), row('St Alma', 4_330_910, 0)]);
    assert.equal(total.wageCents, 3_139_107 + 788_014 + 4_330_910);
    assert.deepEqual(total.unallocatedVenues, ['Both']);
    assert.equal(total.unallocatedWageCents, 788_014);
  });
});
