import assert from "node:assert/strict";
import test from "node:test";
import {
  admittedExternalPoolCents,
  buildPaymentSchedule,
  computeDistribution,
  earnedPerformanceCents,
  type CreditorClaimInput,
} from "./creditors.js";

const D = (dollars: number) => Math.round(dollars * 100);

test("director loans and intercompany are excluded from the pool by default", () => {
  const claims: CreditorClaimInput[] = [
    { creditorName: "Trade supplier", creditorClass: "EXTERNAL_TRADE", claimedAmountCents: D(100_000) },
    { creditorName: "Director", creditorClass: "DIRECTOR_LOAN", claimedAmountCents: D(500_000) },
    { creditorName: "Other Alma entity", creditorClass: "INTERCOMPANY", claimedAmountCents: D(200_000) },
    { creditorName: "Bank", creditorClass: "SECURED", claimedAmountCents: D(300_000) },
  ];
  assert.equal(admittedExternalPoolCents(claims), D(100_000));
});

test("participation switches are opt-in and additive", () => {
  const claims: CreditorClaimInput[] = [
    { creditorName: "Trade", creditorClass: "EXTERNAL_TRADE", claimedAmountCents: D(100_000) },
    { creditorName: "Director", creditorClass: "DIRECTOR_LOAN", claimedAmountCents: D(50_000) },
  ];
  assert.equal(admittedExternalPoolCents(claims, { includeDirectorLoans: true }), D(150_000));
});

test("admitted amount overrides claimed; rejected and withdrawn proofs never count", () => {
  const claims: CreditorClaimInput[] = [
    { creditorName: "A", creditorClass: "EXTERNAL_TRADE", claimedAmountCents: D(80_000), admittedAmountCents: D(60_000), proofOfDebtStatus: "ADMITTED" },
    { creditorName: "B", creditorClass: "EXTERNAL_TRADE", claimedAmountCents: D(40_000), proofOfDebtStatus: "REJECTED" },
    { creditorName: "C", creditorClass: "EXTERNAL_TRADE", claimedAmountCents: D(10_000), excludedFromDistribution: true },
  ];
  assert.equal(admittedExternalPoolCents(claims), D(60_000));
});

test("Freshwater: reproduces the brief's estimated performance payment and total", () => {
  // Fixed $250,000, contractual performance cap $100,000, external pool $337,915.
  const result = computeDistribution({
    fixedTotalCents: D(250_000),
    performanceCapCents: D(100_000),
    admittedExternalPoolCents: D(337_915),
  });

  // MIN(100,000, MAX(0, 337,915 + 0 - 250,000)) = 87,915
  assert.equal(result.performancePaymentCents, D(87_915));
  assert.equal(result.totalContributionCents, D(337_915));
  assert.equal(result.distributedToCreditorsCents, D(337_915));
  assert.equal(result.performanceLimitedBy, "HUNDRED_CENTS");
  assert.equal(result.fullyPaid, true);
  assert.equal(Math.round(result.centsInDollar), 100);
});

test("distribution is capped at 100 cents in the dollar", () => {
  // A small pool against a large proposal must not overpay creditors.
  const result = computeDistribution({
    fixedTotalCents: D(250_000),
    performanceCapCents: D(100_000),
    admittedExternalPoolCents: D(120_000),
  });
  assert.equal(result.performancePaymentCents, 0, "no top-up once creditors are whole");
  assert.equal(result.performanceLimitedBy, "NOT_REQUIRED");
  assert.equal(result.distributedToCreditorsCents, D(120_000), "never exceeds admitted claims");
  assert.equal(Math.round(result.centsInDollar), 100);
});

test("performance is capped by the contract when the shortfall is larger", () => {
  const result = computeDistribution({
    fixedTotalCents: D(250_000),
    performanceCapCents: D(100_000),
    admittedExternalPoolCents: D(500_000), // shortfall 250,000 > cap
  });
  assert.equal(result.performancePaymentCents, D(100_000));
  assert.equal(result.performanceLimitedBy, "CONTRACTUAL_CAP");
  assert.equal(result.fullyPaid, false);
  assert.equal(Math.round(result.centsInDollar), 70); // 350k of 500k
});

test("performance cannot exceed what the formula actually earned", () => {
  const result = computeDistribution({
    fixedTotalCents: D(250_000),
    performanceCapCents: D(100_000),
    admittedExternalPoolCents: D(500_000),
    earnedPerformanceCents: D(30_000),
  });
  assert.equal(result.performancePaymentCents, D(30_000));
  assert.equal(result.performanceLimitedBy, "EARNED_PERFORMANCE");
});

test("deed costs funded from the proposal reduce what reaches creditors", () => {
  const result = computeDistribution({
    fixedTotalCents: D(250_000),
    performanceCapCents: D(100_000),
    admittedExternalPoolCents: D(337_915),
    deedCostsFundedFromProposalCents: D(20_000),
  });
  // Required to reach full = 337,915 + 20,000 - 250,000 = 107,915, capped at 100,000.
  assert.equal(result.performancePaymentCents, D(100_000));
  assert.equal(result.performanceLimitedBy, "CONTRACTUAL_CAP");
  // Reaching creditors = (250,000 - 20,000) + 100,000 = 330,000, short of the pool.
  assert.equal(result.distributedToCreditorsCents, D(330_000));
  assert.equal(result.fullyPaid, false);
});

test("Avalon: fixed 100k with a 125k performance cap tops out at 225k of contribution", () => {
  const result = computeDistribution({
    fixedTotalCents: D(100_000),
    performanceCapCents: D(125_000),
    admittedExternalPoolCents: D(400_000),
  });
  assert.equal(result.totalContributionCents, D(225_000), "potential total contribution");
  assert.equal(result.performanceLimitedBy, "CONTRACTUAL_CAP");
});

test("earned performance takes 25% of upside only, never netting off a bad year", () => {
  const earned = earnedPerformanceCents(
    [
      { actualFreeCashCents: D(300_000), baseForecastFreeCashCents: D(200_000) }, // +100k → 25k
      { actualFreeCashCents: D(150_000), baseForecastFreeCashCents: D(200_000) }, // below base → 0
      { actualFreeCashCents: D(240_000), baseForecastFreeCashCents: D(200_000) }, // +40k → 10k
    ],
    25,
  );
  assert.equal(earned, D(35_000));
});

test("an empty pool distributes nothing and reports zero cents in the dollar", () => {
  const result = computeDistribution({
    fixedTotalCents: D(250_000),
    performanceCapCents: D(100_000),
    admittedExternalPoolCents: 0,
  });
  assert.equal(result.distributedToCreditorsCents, 0);
  assert.equal(result.centsInDollar, 0);
  assert.equal(result.fullyPaid, false);
});

test("payment schedule follows the agreed per-year profile", () => {
  const schedule = buildPaymentSchedule([D(60_000), D(85_000), D(105_000)], D(87_915));
  assert.equal(schedule.length, 3);
  assert.deepEqual(
    schedule.map((s) => s.fixedCents),
    [D(60_000), D(85_000), D(105_000)],
  );
  assert.equal(schedule[2]?.performanceCents, D(87_915), "performance falls in the final year");
  assert.equal(
    schedule.reduce((t, s) => t + s.totalCents, 0),
    D(337_915),
  );
});
