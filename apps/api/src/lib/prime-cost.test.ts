import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { elapsedPeriodWeeks, salariedPeriodCents, resolvePrimeCost, resolveCostTargets, DEFAULT_COST_TARGETS } from '@alma/shared';

const BOUNDED = { cogsCents: 3_000_000, purchasesCents: 2_800_000, source: 'stock_bounded' as const, quality: 'complete' };
const BILLS_ONLY = { cogsCents: 494_878, purchasesCents: 494_878, source: 'purchases_only' as const, quality: 'estimated', reasons: ['Opening stock is unavailable: Alma Avalon has no finalised stocktake on or before 2026-06-01.'] };
const LABOUR = { cents: 3_100_000, basis: 'timesheets' as const };

describe('prime cost = labour + actual food COGS, or nothing', () => {
  it('adds labour to a stocktake-bounded, covered food figure', () => {
    const prime = resolvePrimeCost({ salesCents: 10_000_000, labour: LABOUR, food: BOUNDED, purchaseCoverage: 1 });
    assert.equal(prime.foodBasis, 'actual');
    assert.equal(prime.primeCostCents, 3_100_000 + 3_000_000);
    assert.equal(prime.primeCostPercent, 61);
    assert.equal(prime.foodCostPercent, 30);
    assert.equal(prime.wagePercent, 31);
    assert.deepEqual(prime.reasons, []);
  });

  it('the symptom: labour + supplier bills is never prime cost', () => {
    // The Recap showed wages + three weeks of bills as "prime cost 31.8%".
    const prime = resolvePrimeCost({ salesCents: 10_000_000, labour: LABOUR, food: BILLS_ONLY, purchaseCoverage: 1 });
    assert.equal(prime.foodBasis, 'unavailable');
    assert.equal(prime.foodCostCents, null);
    assert.equal(prime.primeCostCents, null);
    assert.equal(prime.primeCostPercent, null);
    assert.equal(prime.foodCostPercent, null);
    // What WAS recorded is still stated, as what it is.
    assert.equal(prime.purchasesCents, 494_878);
    // Labour ÷ sales stands on its own.
    assert.equal(prime.wagePercent, 31);
    assert.match(prime.reasons[0] ?? '', /no finalised stocktake on or before 2026-06-01/);
  });

  it('a bounded figure over incomplete invoices is not the period’s food cost', () => {
    const prime = resolvePrimeCost({ salesCents: 10_000_000, labour: LABOUR, food: BOUNDED, purchaseCoverage: 0.25 });
    assert.equal(prime.foodBasis, 'unavailable');
    assert.equal(prime.primeCostCents, null);
    assert.match(prime.reasons.join(' '), /cover 25% of the period/);
  });

  it('without labour there is no prime cost either, and no labour %', () => {
    const prime = resolvePrimeCost({ salesCents: 10_000_000, labour: { cents: 0, basis: 'missing' }, food: BOUNDED, purchaseCoverage: 1 });
    assert.equal(prime.primeCostCents, null);
    assert.equal(prime.wagePercent, null);
    assert.equal(prime.foodCostCents, 3_000_000);
  });

  it('a roster estimate is carried with its basis, not upgraded to actuals', () => {
    const prime = resolvePrimeCost({ salesCents: 10_000_000, labour: { cents: 2_000_000, basis: 'roster_estimate' }, food: BOUNDED, purchaseCoverage: 1 });
    assert.equal(prime.labourBasis, 'roster_estimate');
    assert.equal(prime.primeCostCents, 5_000_000);
  });

  it('no sales: dollars stand, percentages do not', () => {
    const prime = resolvePrimeCost({ salesCents: 0, labour: LABOUR, food: BOUNDED, purchaseCoverage: 1 });
    assert.equal(prime.primeCostCents, 6_100_000);
    assert.equal(prime.primeCostPercent, null);
  });
});

describe('salaries are booked for the elapsed part of the period', () => {
  const start = new Date('2026-05-31T14:00:00Z'); // 1 June Sydney
  const end = new Date('2026-06-30T14:00:00Z'); // 1 July Sydney

  it('on the 11th of a 30-day month, ten days of salary have elapsed', () => {
    const weeks = elapsedPeriodWeeks(start, end, new Date('2026-06-10T14:00:00Z'));
    assert.equal(Math.round(weeks * 7), 10);
  });

  it('a finished month carries the full month, no more', () => {
    assert.equal(Math.round(elapsedPeriodWeeks(start, end, new Date('2026-09-01T00:00:00Z')) * 7), 30);
  });

  it('a month that has not started carries nothing', () => {
    assert.equal(elapsedPeriodWeeks(start, end, new Date('2026-05-01T00:00:00Z')), 0);
  });
});

describe('one canonical target source', () => {
  const venues = [
    { name: 'Alma Avalon', targetWagePercent: 28, targetPrimeCostPercent: 58 },
    { name: 'St Alma', targetWagePercent: 32, targetPrimeCostPercent: 62 }
  ];

  it('a venue with settings gets its own targets; food is prime less labour', () => {
    const t = resolveCostTargets(venues, 'St Alma');
    assert.deepEqual([t.wagePct, t.foodPct, t.primePct, t.source], [32, 30, 62, 'venue']);
  });

  it('the group is the mean of configured venues, and says so', () => {
    const t = resolveCostTargets(venues, null);
    assert.deepEqual([t.wagePct, t.foodPct, t.primePct, t.source], [30, 30, 60, 'group_average']);
  });

  it('nothing configured falls back to the defaults, labelled default', () => {
    const t = resolveCostTargets([{ name: 'Alma Avalon' }], 'Alma Avalon');
    assert.equal(t.source, 'default');
    assert.deepEqual([t.wagePct, t.foodPct, t.primePct], [DEFAULT_COST_TARGETS.wagePct, DEFAULT_COST_TARGETS.foodPct, DEFAULT_COST_TARGETS.primePct]);
  });

  it('a venue with only a prime target still gets a consistent triangle', () => {
    const t = resolveCostTargets([{ name: 'Alma Avalon', targetPrimeCostPercent: 55 }], 'Alma Avalon');
    assert.deepEqual([t.wagePct, t.foodPct, t.primePct, t.configured.wage, t.configured.prime], [30, 25, 55, false, true]);
  });
});

describe('group fail-closed: an invalid venue or an incomplete purchase feed keeps prime unavailable', () => {
  it('a stocktake-bounded food figure over an incomplete invoice feed is not the period\'s food cost', () => {
    const prime = resolvePrimeCost({
      salesCents: 16_443_414,
      labour: { cents: 7_745_419, basis: 'timesheets' },
      food: BOUNDED,
      purchaseCoverage: 0.93,
      purchaseFeed: { status: 'incomplete', reason: '1 regular supplier has no invoice in this period (FoodByUs: 45 invoice dates in the 90 days to 2026-07-11, then nothing for 51 days — an unresolved absence carried forward).' }
    });
    assert.equal(prime.foodBasis, 'unavailable');
    assert.equal(prime.foodCostCents, null);
    assert.equal(prime.primeCostCents, null);
    assert.equal(prime.foodCostPercent, null);
    assert.match(prime.reasons.join(' '), /invoice feed is incomplete .* carried forward/);
    // The dollars recorded stay visible, as purchases; labour % stands on its own.
    assert.equal(prime.purchasesCents, 2_800_000);
    assert.equal(prime.wagePercent, 47.1);
  });

  it('a feed that is too early to judge does not withhold a bounded figure; a complete one does not either', () => {
    for (const status of ['too_early', 'complete'] as const) {
      const prime = resolvePrimeCost({ salesCents: 10_000_000, labour: LABOUR, food: BOUNDED, purchaseCoverage: 1, purchaseFeed: { status, reason: null } });
      assert.equal(prime.foodBasis, 'actual', status);
    }
  });
});

describe('the one cent: an in-progress month gives every caller the same salaried cents on the same day', () => {
  // September 2026 (in progress on the 26th): the Recap read Alma Avalon
  // labour $29,626.63 and the Prime Cost report $29,626.64, from the same
  // rows. Each had passed its own `new Date()`, seconds apart, into a
  // continuous elapsed-weeks fraction; `Math.round(weekly × weeks)` fell
  // either side of a half-cent. Salaries accrue by the day: two calls on
  // one venue day must give one number.
  const start = new Date('2026-08-31T14:00:00Z'); // 1 Sep 00:00 Sydney
  const end = new Date('2026-09-30T14:00:00Z');
  const WEEK_MS = 7 * 86_400_000;
  /** The previous arithmetic: elapsed time continuous in `now`. */
  const continuousCents = (weekly: number, now: Date) => Math.round(weekly * Math.max(0, (Math.min(end.getTime(), now.getTime()) - start.getTime()) / WEEK_MS));

  it('reproduces the divergence: two instants seconds apart on 26 Sep, and the old arithmetic rounds a salary share to different cents', () => {
    const weekly = 250_000; // $2,500.00 a week + super: one cent of accrual every ~2.4 seconds
    // Walk 26 Sep (Sydney) second by second until the old rounding flips.
    const dayStart = new Date('2026-09-25T14:00:00Z');
    let a: Date | null = null;
    let b: Date | null = null;
    for (let sec = 0; sec < 600 && !b; sec += 1) {
      const t1 = new Date(dayStart.getTime() + sec * 1000);
      const t2 = new Date(t1.getTime() + 1000);
      if (continuousCents(weekly, t1) !== continuousCents(weekly, t2)) {
        a = t1;
        b = t2;
      }
    }
    assert.ok(a && b, 'the continuous arithmetic must flip a cent within the first ten minutes of the day');
    assert.equal(Math.abs(continuousCents(weekly, a!) - continuousCents(weekly, b!)), 1);
    // The canonical function does not: both instants are the same venue day.
    assert.equal(salariedPeriodCents(weekly, start, end, a!), salariedPeriodCents(weekly, start, end, b!));
    // …and its value is the whole-day one: 25 days elapsed of September by the start of the 26th.
    assert.equal(salariedPeriodCents(weekly, start, end, a!), Math.round(weekly * (25 / 7)));
    assert.equal(elapsedPeriodWeeks(start, end, b!) * 7, 25);
  });

  it('any instant on the same venue day gives the same weeks; the next venue day gives one more', () => {
    const morning = new Date('2026-09-25T14:00:01Z'); // 00:00:01 26 Sep Sydney
    const night = new Date('2026-09-26T13:59:59Z'); // 23:59:59 26 Sep Sydney
    assert.equal(elapsedPeriodWeeks(start, end, morning), elapsedPeriodWeeks(start, end, night));
    assert.equal(elapsedPeriodWeeks(start, end, new Date('2026-09-26T14:00:00Z')) * 7, 26);
  });

  it('a Recap figure and a Prime figure built from the same salaried rows at different instants agree to the cent', () => {
    // Three salaried workers, split across two venues as the September rows were.
    const staff = [
      { weekly: 288_461, split: [['Alma Avalon', 1]] as Array<[string, number]> },
      { weekly: 230_769, split: [['St Alma', 1]] as Array<[string, number]> },
      { weekly: 192_307, split: [['Alma Avalon', 0.4], ['St Alma', 0.6]] as Array<[string, number]> }
    ];
    const rowsAt = (now: Date) => {
      const rows = new Map<string, number>();
      for (const s of staff) {
        const fixed = salariedPeriodCents(s.weekly, start, end, now);
        for (const [venue, fraction] of s.split) rows.set(venue, (rows.get(venue) ?? 0) + Math.round(fixed * fraction));
      }
      return rows;
    };
    const recap = rowsAt(new Date('2026-09-26T05:12:07.000Z'));
    const prime = rowsAt(new Date('2026-09-26T05:12:11.500Z'));
    assert.deepEqual([...recap.entries()], [...prime.entries()]);
    assert.equal([...recap.values()].reduce((a, b) => a + b, 0), [...prime.values()].reduce((a, b) => a + b, 0));
  });
});
