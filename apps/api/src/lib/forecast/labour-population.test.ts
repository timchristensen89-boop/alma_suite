import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyLabourPopulation, classifyWorker } from './labour-population.js';
import { costForRate, staffCostingRate, weeklyFixedCostCents, type StaffCostProfile } from '../staff-pay-rates.js';

const SUPER = 0.12;
const payProfile = (over: Partial<NonNullable<StaffCostProfile['payProfile']>>): NonNullable<StaffCostProfile['payProfile']> => ({
  employmentType: 'CASUAL',
  payMode: 'AWARD',
  ordinaryHourlyRateCents: 0,
  casualLoadedHourlyRateCents: null,
  manualFullTimePayAmountCents: null,
  manualFullTimePayFrequency: null,
  cashHourlyRateCents: null,
  ...over
});

const MANAGER = { id: 'mgr', employmentType: 'FULL_TIME', payRateCents: null, trainingPayRateCents: null, payProfile: payProfile({ employmentType: 'FULL_TIME', payMode: 'MANUAL_FULL_TIME', manualFullTimePayAmountCents: 9_000_000, manualFullTimePayFrequency: 'ANNUAL' }) };
// The symptom: a casual WITH a pay profile row.
const CASUAL_WITH_PROFILE = { id: 'cas', employmentType: 'Casual', payRateCents: null, trainingPayRateCents: null, payProfile: payProfile({ employmentType: 'CASUAL', casualLoadedHourlyRateCents: 3_500 }) };
const CASUAL_NO_PROFILE = { id: 'cas2', employmentType: 'Casual', payRateCents: 3_200, trainingPayRateCents: null, payProfile: null };
const NO_RATE = { id: 'none', employmentType: 'Part-time', payRateCents: null, trainingPayRateCents: null, payProfile: null };

describe('every worker is in exactly one labour population', () => {
  it('salaried iff the resolved rate carries a weekly fixed cost; hourly otherwise; missing rate stated', () => {
    const pop = classifyLabourPopulation([MANAGER, CASUAL_WITH_PROFILE, CASUAL_NO_PROFILE, NO_RATE], SUPER);
    assert.deepEqual(pop.summary, { salaried: 1, hourly: 2, missingRate: 1 });
    assert.equal(pop.salariedIds.has('mgr'), true);
    assert.equal(pop.hourlyIds.has('cas'), true);
    assert.equal(pop.hourlyIds.has('cas2'), true);
    assert.equal(pop.missingRateIds.has('none'), true);
    for (const row of pop.rows) {
      const memberships = [pop.salariedIds, pop.hourlyIds, pop.missingRateIds].filter((set) => set.has(row.staffProfileId)).length;
      assert.equal(memberships, 1, `${row.staffProfileId} is in ${memberships} populations`);
    }
  });

  it('the symptom: a casual with a pay profile is hourly, so their shifts carry cost', () => {
    // Under the old "has a pay profile = salaried" rule this worker was
    // skipped from hourly costing and had zero fixed cost: in neither.
    const rate = staffCostingRate(CASUAL_WITH_PROFILE, SUPER);
    assert.equal(classifyWorker(rate), 'hourly');
    assert.equal(weeklyFixedCostCents(rate), 0);
    assert.ok(costForRate(rate, { ordinary: 8, overtime: 0 }) > 0);
  });

  it('forecast labour = Σ hourly shifts + Σ salaried weekly share, and nothing else', () => {
    const pop = classifyLabourPopulation([MANAGER, CASUAL_WITH_PROFILE], SUPER);
    const shifts = [
      { staffId: 'mgr', hours: 10 },
      { staffId: 'cas', hours: 8 },
      { staffId: 'cas', hours: 6 }
    ];
    let hourly = 0;
    for (const shift of shifts) {
      if (pop.salariedIds.has(shift.staffId)) continue; // salaried hours allocate, they do not cost
      const rate = staffCostingRate(shift.staffId === 'mgr' ? MANAGER : CASUAL_WITH_PROFILE, SUPER);
      hourly += costForRate(rate, { ordinary: shift.hours, overtime: 0 });
    }
    let salaried = 0;
    for (const id of pop.salariedIds) salaried += weeklyFixedCostCents(staffCostingRate(id === 'mgr' ? MANAGER : CASUAL_WITH_PROFILE, SUPER));
    const casualRate = staffCostingRate(CASUAL_WITH_PROFILE, SUPER);
    assert.equal(hourly, costForRate(casualRate, { ordinary: 14, overtime: 0 }));
    assert.equal(salaried, weeklyFixedCostCents(staffCostingRate(MANAGER, SUPER)));
    assert.ok(salaried > 0);
  });
});
