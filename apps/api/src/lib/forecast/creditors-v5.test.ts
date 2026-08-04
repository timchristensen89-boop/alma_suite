// Locks the creditor engine to the figures published in the v5 Indicative
// Creditor Funding Proposal (30 July 2026), the document going to the
// Voluntary Administrator. If a change here breaks these, the proposal and the
// system no longer agree, and the proposal is the thing creditors see.

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSeasonalSchedule, distributionAtRateCents, scheduleTotalCents } from './creditors.js';

const D = (dollars: number) => Math.round(dollars * 100);

const AVALON_POOL = D(377_369);
const FRESHWATER_POOL = D(337_915);

test('cents in the dollar reproduces every headline distribution in v5', () => {
  assert.equal(distributionAtRateCents(AVALON_POOL, 10), D(37_736.9), 'Avalon base 10c');
  assert.equal(distributionAtRateCents(AVALON_POOL, 15), D(56_605.35), 'Avalon maximum 15c');
  assert.equal(distributionAtRateCents(FRESHWATER_POOL, 10), D(33_791.5), 'Freshwater base 10c');
  assert.equal(distributionAtRateCents(FRESHWATER_POOL, 15), D(50_687.25), 'Freshwater maximum 15c');

  // The 5c performance increment is the gap between base and maximum.
  assert.equal(distributionAtRateCents(AVALON_POOL, 5), D(18_868.45));
  assert.equal(distributionAtRateCents(FRESHWATER_POOL, 5), D(16_895.75));

  // Combined, as stated in the executive summary.
  const combined = AVALON_POOL + FRESHWATER_POOL;
  assert.equal(combined, D(715_284));
  assert.equal(distributionAtRateCents(combined, 10), D(71_528.4));
  assert.equal(distributionAtRateCents(combined, 15), D(107_292.6));
});

test('the distribution moves with the admitted pool, which is the point of a rate', () => {
  // Section 7: returns recalculate as proofs of debt are adjudicated, so no
  // renegotiation of the rate is needed.
  assert.equal(distributionAtRateCents(D(300_000), 10), D(30_000));
  assert.equal(distributionAtRateCents(D(450_000), 10), D(45_000));
  assert.equal(distributionAtRateCents(0, 10), 0, 'an empty pool distributes nothing');
});

test('a rate can never exceed 100 cents in the dollar', () => {
  assert.equal(distributionAtRateCents(D(100_000), 100), D(100_000));
  assert.equal(distributionAtRateCents(D(100_000), 150), D(100_000), 'clamped, not overpaid');
});

test('Freshwater 20/30/50 reproduces all six published instalments', () => {
  const schedule = buildSeasonalSchedule({
    totalCents: distributionAtRateCents(FRESHWATER_POOL, 10),
    yearShares: [0.2, 0.3, 0.5],
  });
  assert.deepEqual(
    schedule.map((instalment) => instalment.cents),
    [D(2_703.32), D(4_054.98), D(4_054.98), D(6_082.47), D(6_758.3), D(10_137.45)],
  );
  assert.deepEqual(
    schedule.map((instalment) => `${instalment.yearNumber}-${instalment.month}`),
    ['1-DECEMBER', '1-JANUARY', '2-DECEMBER', '2-JANUARY', '3-DECEMBER', '3-JANUARY'],
  );
});

test('Avalon defers year one entirely and still reconciles', () => {
  // No year-one distribution: the conservative case dips to -$20,543 in month
  // three before recovering through summer, so an instalment cannot be funded.
  const schedule = buildSeasonalSchedule({
    totalCents: distributionAtRateCents(AVALON_POOL, 10),
    yearShares: [0, 0.35, 0.65],
  });
  assert.equal(schedule.length, 4, 'year one produces no instalment at all');
  assert.ok(schedule.every((instalment) => instalment.yearNumber !== 1));
  assert.deepEqual(
    schedule.map((instalment) => instalment.cents),
    [D(5_283.17), D(7_924.75), D(9_811.59), D(14_717.39)],
  );
});

test('a schedule always sums to the committed distribution, to the cent', () => {
  // The published v5 Avalon year-three subtotal reads $24,528.99 while its two
  // instalments sum to $24,528.98 — the result of rounding each instalment
  // independently. Residual allocation makes that impossible here.
  for (const [pool, shares] of [
    [AVALON_POOL, [0, 0.35, 0.65]],
    [FRESHWATER_POOL, [0.2, 0.3, 0.5]],
  ] as const) {
    for (const rate of [10, 15]) {
      const total = distributionAtRateCents(pool, rate);
      const schedule = buildSeasonalSchedule({ totalCents: total, yearShares: shares });
      assert.equal(scheduleTotalCents(schedule), total, `${rate}c schedule must reconcile exactly`);
    }
  }

  // And for pools that divide badly, which is where drift would show up.
  for (const pool of [D(377_369.01), D(1), D(999_999.99), D(333_333.33)]) {
    const total = distributionAtRateCents(pool, 10);
    assert.equal(scheduleTotalCents(buildSeasonalSchedule({ totalCents: total, yearShares: [0.2, 0.3, 0.5] })), total);
  }
});

test('the maximum 15c schedule scales in the same proportions', () => {
  // "instalments scale in the same proportions to a total of $56,605.35"
  const schedule = buildSeasonalSchedule({
    totalCents: distributionAtRateCents(AVALON_POOL, 15),
    yearShares: [0, 0.35, 0.65],
  });
  assert.equal(scheduleTotalCents(schedule), D(56_605.35));
  const freshwater = buildSeasonalSchedule({
    totalCents: distributionAtRateCents(FRESHWATER_POOL, 15),
    yearShares: [0.2, 0.3, 0.5],
  });
  assert.equal(scheduleTotalCents(freshwater), D(50_687.25));
});
