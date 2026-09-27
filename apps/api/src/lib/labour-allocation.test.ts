import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allocateLabour, resolveLabourVenue, venueRow, type CostedTimesheet } from './labour-allocation.js';
import { labourTotal } from './labour-rows.js';

const VENUES = ['Alma Avalon', 'St Alma'];
const ts = (venueLabel: string | null, profileVenueLabel: string | null, cents: number, hours = 1): CostedTimesheet => ({ venueLabel, profileVenueLabel, cents, approved: true, hours });

describe('one labour allocation rule: where a dollar of labour goes is explicit', () => {
  it('a timesheet naming a configured venue is explicit; one naming nothing follows the profile venue and says so', () => {
    assert.deepEqual(resolveLabourVenue('Alma Avalon', 'St Alma', VENUES), { key: 'Alma Avalon', status: 'configured', source: 'explicit' });
    assert.deepEqual(resolveLabourVenue('', 'St Alma', VENUES), { key: 'St Alma', status: 'configured', source: 'profile' });
    assert.deepEqual(resolveLabourVenue(null, ' avalon ', VENUES), { key: 'Alma Avalon', status: 'configured', source: 'profile' });
  });

  it('a label that is not a venue is kept as itself and flagged, never guessed into a restaurant', () => {
    assert.deepEqual(resolveLabourVenue('Both', 'St Alma', VENUES), { key: 'Both', status: 'invalid', source: 'invalid' });
    assert.deepEqual(resolveLabourVenue(null, 'Both', VENUES), { key: 'Both', status: 'invalid', source: 'invalid' });
    assert.deepEqual(resolveLabourVenue(null, 'Some Person', VENUES), { key: 'Some Person', status: 'invalid', source: 'invalid' });
    assert.deepEqual(resolveLabourVenue(null, null, VENUES), { key: 'Unassigned', status: 'unassigned', source: 'unassigned' });
  });
});

describe('the real July / August differences: a venue report and the group\'s row for that venue are the same allocation', () => {
  // July 2026, Alma Avalon: $41,151.54 of timesheets that name the venue and
  // $713.90 of timesheets with no venue whose workers' profile venue is
  // Alma Avalon. The group view used to place the $713.90 under Avalon; the
  // venue-scoped query (timesheet.venue only) did not.
  const july = allocateLabour({
    configuredVenues: VENUES,
    timesheets: [ts('Alma Avalon', 'Alma Avalon', 4_115_154, 900), ts(null, 'Alma Avalon', 71_390, 16), ts('St Alma', 'St Alma', 5_437_321, 1300)],
    shifts: [],
    salaried: []
  });

  it('July Avalon: the venue row carries both parts and says which is the fallback', () => {
    const avalon = venueRow(july, 'Alma Avalon', VENUES)!;
    assert.equal(avalon.wageCents, 4_186_544);
    assert.equal(avalon.explicitWageCents, 4_115_154);
    assert.equal(avalon.profileFallbackWageCents, 71_390);
    assert.equal(avalon.venueStatus, 'configured');
  });

  it('the venue-scoped figure IS the group\'s row: one population, not two queries', () => {
    const group = labourTotal(july.values());
    assert.equal(group.wageCents, 4_186_544 + 5_437_321);
    assert.equal(venueRow(july, 'Alma Avalon', VENUES)!.wageCents + venueRow(july, 'St Alma', VENUES)!.wageCents, group.wageCents);
    assert.equal(group.profileFallbackWageCents, 71_390);
    assert.equal(group.unallocatedWageCents, 0);
  });

  it('August St Alma: $856.80 of null-venue timesheets, same rule', () => {
    const august = allocateLabour({
      configuredVenues: VENUES,
      timesheets: [ts('St Alma', 'St Alma', 5_369_797, 1170), ts(null, 'St Alma', 85_680, 20)],
      shifts: [],
      salaried: []
    });
    const stAlma = venueRow(august, 'St Alma', VENUES)!;
    assert.equal(stAlma.wageCents, 5_455_477);
    assert.equal(stAlma.profileFallbackWageCents, 85_680);
    assert.equal(labourTotal(august.values()).wageCents, 5_455_477);
  });
});

describe('labour under a label that is not a venue: in the group, in no venue, never invented into one', () => {
  it('June 2026: a salaried share whose home venue is "Both" is an invalid-venue row, counted in the group and excluded from both venue reports', () => {
    const june = allocateLabour({
      configuredVenues: VENUES,
      timesheets: [ts('Alma Avalon', 'Alma Avalon', 3_139_107, 630), ts('St Alma', 'St Alma', 4_330_910, 920)],
      shifts: [],
      salaried: [{ venueKey: resolveLabourVenue(null, 'Both', VENUES), cents: 788_014 }]
    });
    const both = june.get('Both')!;
    assert.equal(both.venueStatus, 'invalid');
    assert.equal(both.wageCents, 788_014);
    assert.equal(both.salariedWageCents, 788_014);
    const group = labourTotal(june.values());
    assert.equal(group.wageCents, 3_139_107 + 4_330_910 + 788_014);
    assert.deepEqual(group.unallocatedVenues, ['Both']);
    assert.equal(group.unallocatedWageCents, 788_014);
    assert.equal(venueRow(june, 'Alma Avalon', VENUES)!.wageCents + venueRow(june, 'St Alma', VENUES)!.wageCents + group.unallocatedWageCents, group.wageCents);
    assert.equal(venueRow(june, 'Both', VENUES), june.get('Both'));
  });

  it('a person\'s name written into a venue field is an invalid-venue row, not a venue', () => {
    const rows = allocateLabour({ configuredVenues: VENUES, timesheets: [ts('Some Person', null, 125_093, 32)], shifts: [], salaried: [] });
    assert.deepEqual([...rows.keys()], ['Some Person']);
    assert.equal(rows.get('Some Person')!.venueStatus, 'invalid');
    assert.deepEqual(labourTotal(rows.values()).unallocatedVenues, ['Some Person']);
  });

  it('a roster-only "Both" shift is an estimate on an invalid row: not actual labour, not unallocated labour', () => {
    const rows = allocateLabour({ configuredVenues: VENUES, timesheets: [], shifts: [{ venueLabel: 'Both', profileVenueLabel: 'St Alma', cents: 19_322, hours: 5.5 }], salaried: [] });
    const total = labourTotal(rows.values());
    assert.equal(total.wageCents, 0);
    assert.equal(total.unallocatedWageCents, 0);
    assert.deepEqual(total.rosterOnlyVenues, ['Both']);
    assert.equal(total.rosterOnlyEstimateCents, 19_322);
  });
});
