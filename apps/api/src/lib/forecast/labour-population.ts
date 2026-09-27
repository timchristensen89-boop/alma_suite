// Who is salaried and who is hourly, decided once for the forecast so every
// worker lands in exactly one labour population. Covered by
// labour-population.test.ts.
//
//   forecast labour = Σ hourly shift cost + Σ applicable salaried weekly share
//
// Background: the outlook treated "has a pay profile" as "salaried". A
// casual with a pay profile was skipped from hourly costing (as salaried)
// AND contributed no weekly fixed cost (weeklyFixedCostCents is 0 for a
// flat rate), so their rostered shifts cost nothing. A salaried manager
// without a pay profile row was not in the salaried list either. The rule
// here is the one the pay-rate resolver already encodes: a worker is
// salaried when their resolved rate carries a weekly fixed cost.

import { staffCostingRate, weeklyFixedCostCents, type StaffCostProfile, type StaffCostingRate } from '../staff-pay-rates.js';

export type LabourClassification = 'salaried' | 'hourly' | 'missing_rate';

export type LabourPopulationRow = {
  staffProfileId: string;
  classification: LabourClassification;
  /** The resolver's own description of the rate, e.g. "Salary ÷ 45h/wk + super · OT>45h". */
  rateSource: string;
  weeklyFixedCostCents: number;
};

export type LabourPopulation = {
  rows: LabourPopulationRow[];
  salariedIds: Set<string>;
  hourlyIds: Set<string>;
  missingRateIds: Set<string>;
  summary: { salaried: number; hourly: number; missingRate: number };
};

export function classifyWorker(rate: StaffCostingRate): LabourClassification {
  if (weeklyFixedCostCents(rate) > 0) return 'salaried';
  if (rate.rateCents != null && rate.rateCents > 0) return 'hourly';
  return 'missing_rate';
}

export function classifyLabourPopulation<T extends StaffCostProfile & { id: string }>(
  profiles: ReadonlyArray<T>,
  superRate: number
): LabourPopulation {
  const rows: LabourPopulationRow[] = [];
  const salariedIds = new Set<string>();
  const hourlyIds = new Set<string>();
  const missingRateIds = new Set<string>();
  for (const profile of profiles) {
    const rate = staffCostingRate(profile, superRate);
    const classification = classifyWorker(rate);
    rows.push({ staffProfileId: profile.id, classification, rateSource: rate.source, weeklyFixedCostCents: weeklyFixedCostCents(rate) });
    if (classification === 'salaried') salariedIds.add(profile.id);
    else if (classification === 'hourly') hourlyIds.add(profile.id);
    else missingRateIds.add(profile.id);
  }
  return {
    rows,
    salariedIds,
    hourlyIds,
    missingRateIds,
    summary: { salaried: salariedIds.size, hourly: hourlyIds.size, missingRate: missingRateIds.size }
  };
}
