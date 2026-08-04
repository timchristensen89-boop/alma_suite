import assert from "node:assert/strict";
import test from "node:test";
import {
  applyScenario,
  compareScenarios,
  DEFAULT_SCENARIOS,
  groupComparison,
  projectYear,
  runScenario,
  type AssumptionSet,
} from "./scenarios.js";

const D = (dollars: number) => Math.round(dollars * 100);

/** Avalon's seeded assumptions from the brief. */
const AVALON: AssumptionSet = {
  annualBaseSalesCents: D(1_271_589.05),
  annualGrowthPercent: 2,
  menuPriceUpliftPerItemCents: D(1),
  menuPriceRealisationPercent: 100,
  grossWagesWeeklyCents: D(7_000),
  superPercent: 12,
  cogsTargetPercent: 25.3,
  monthlyRentExGstCents: D(12_828.77),
  monthlyCleaningCents: D(614),
  monthlySoftwareCents: D(609),
  otherOperatingPercent: 7,
  maintenanceReservePercent: 1,
  financeRepaymentsMonthlyCents: D(11_656) + D(815.5),
  administrationFeeTotalCents: D(25_000),
  openingCashCents: 0,
  netGstReservePercent: 5.82,
};

const FRESHWATER: AssumptionSet = {
  ...AVALON,
  annualBaseSalesCents: D(1_628_470.48),
  grossWagesWeeklyCents: D(9_000),
  cogsTargetPercent: 25.5,
  monthlyRentExGstCents: D(11_067.5),
  monthlyCleaningCents: D(1_021),
  monthlySoftwareCents: D(689),
  otherOperatingPercent: 7.5,
  financeRepaymentsMonthlyCents: 0, // no NAB or Plenti at Freshwater
  netGstReservePercent: 6.1,
};

test("a scenario never mutates the base assumptions", () => {
  const snapshot = JSON.stringify(AVALON);
  applyScenario(AVALON, { salesPercent: -10, cogsPercentagePointDelta: 2 });
  assert.equal(JSON.stringify(AVALON), snapshot, "base must survive untouched");
});

test("two scenarios evaluated together cannot contaminate each other", () => {
  const conservative = applyScenario(AVALON, { salesPercent: -10 });
  const recovery = applyScenario(AVALON, { salesPercent: 5 });
  assert.ok(conservative.annualBaseSalesCents < AVALON.annualBaseSalesCents);
  assert.ok(recovery.annualBaseSalesCents > AVALON.annualBaseSalesCents);
  // Re-deriving conservative gives the same answer as the first time.
  assert.equal(applyScenario(AVALON, { salesPercent: -10 }).annualBaseSalesCents, conservative.annualBaseSalesCents);
});

test("COGS adjustments are percentage POINTS, not a relative change", () => {
  const adjusted = applyScenario(AVALON, { cogsPercentagePointDelta: 2 });
  assert.equal(adjusted.cogsTargetPercent, 27.3, "25.3 + 2 points");
});

test("labour and sales adjustments are relative percentages", () => {
  const adjusted = applyScenario(AVALON, { labourPercent: 2, salesPercent: -10 });
  assert.equal(adjusted.grossWagesWeeklyCents, D(7_140));
  assert.equal(adjusted.annualBaseSalesCents, Math.round(D(1_271_589.05) * 0.9));
});

test("closures remove trading days proportionally", () => {
  const closed = applyScenario(AVALON, { closureDays: 36.5 }); // 10% of the year
  assert.ok(closed.annualBaseSalesCents < AVALON.annualBaseSalesCents);
  assert.equal(closed.annualBaseSalesCents, Math.round(AVALON.annualBaseSalesCents * 0.9));
});

test("menu-price realisation scales the uplift, it is not a flat add", () => {
  const full = projectYear(AVALON, { menuUpliftSalesPercent: 3 });
  const discounted = projectYear(
    applyScenario(AVALON, { menuPriceRealisationPercent: -10 }),
    { menuUpliftSalesPercent: 3 },
  );
  assert.ok(discounted.netSalesExGstCents < full.netSalesExGstCents, "90% realisation earns less than 100%");
  const noUplift = projectYear(AVALON, { menuUpliftSalesPercent: 0 });
  assert.ok(full.netSalesExGstCents > noUplift.netSalesExGstCents);
});

test("the year projection reproduces the seeded cost structure", () => {
  const year = projectYear(AVALON);
  assert.equal(year.netSalesExGstCents, D(1_271_589.05));
  assert.equal(year.cogsCents, Math.round(D(1_271_589.05) * 0.253));
  assert.equal(year.grossWagesCents, D(7_000) * 52);
  assert.equal(year.superCents, Math.round(D(7_000) * 52 * 0.12));
  assert.equal(year.rentCents, D(12_828.77) * 12);
  assert.equal(year.cogsPercent, 25.3);
});

test("the administration fee falls only in the first year", () => {
  assert.equal(projectYear(AVALON, { yearIndex: 0 }).administrationCents, D(25_000));
  assert.equal(projectYear(AVALON, { yearIndex: 1 }).administrationCents, 0);
});

test("growth compounds across years", () => {
  const year1 = projectYear(AVALON, { yearIndex: 0 });
  const year3 = projectYear(AVALON, { yearIndex: 2 });
  assert.equal(year3.netSalesExGstCents, Math.round(year1.netSalesExGstCents * 1.02 ** 2));
});

test("Freshwater carries no NAB or Plenti repayment in the standalone model", () => {
  assert.equal(projectYear(FRESHWATER).financeRepaymentsCents, 0);
  assert.ok(projectYear(AVALON).financeRepaymentsCents > 0);
});

test("conservative produces less free cash than base, recovery more", () => {
  const [base, conservative, recovery] = DEFAULT_SCENARIOS.map((scenario) =>
    runScenario(scenario, AVALON, { years: 3, menuUpliftSalesPercent: 3 }),
  );
  assert.ok((conservative?.totalFreeCashCents ?? 0) < (base?.totalFreeCashCents ?? 0));
  assert.ok((recovery?.totalFreeCashCents ?? 0) > (base?.totalFreeCashCents ?? 0));
});

test("a scenario reports the years where free cash goes negative", () => {
  const brutal = runScenario(
    { key: "STRESS", name: "Stress", description: "", adjustments: { salesPercent: -45 } },
    AVALON,
    { years: 3 },
  );
  assert.ok(brutal.warningYears.length > 0, "a venue that cannot pay its costs must say so");
  assert.ok(brutal.lowestAnnualFreeCashCents < 0);
});

test("scenario comparison is scoped to one company and never pooled", () => {
  const result = compareScenarios("co_tcc", AVALON, DEFAULT_SCENARIOS, { years: 3 });
  assert.equal(result.companyId, "co_tcc");
  assert.equal(result.isPooled, false);
  assert.equal(result.comparisons.length, 3);
});

test("the group view is explicitly a comparison, not pooled funds", () => {
  const avalon = runScenario(DEFAULT_SCENARIOS[0]!, AVALON, { years: 3 });
  const freshwater = runScenario(DEFAULT_SCENARIOS[0]!, FRESHWATER, { years: 3 });
  const group = groupComparison([
    { companyId: "co_tcc", companyName: "Two Cooked Chooks Pty Ltd", comparison: avalon },
    { companyId: "co_af", companyName: "Alma Freshwater Pty Ltd", comparison: freshwater },
  ]);

  assert.equal(group.isComparisonOnly, true);
  assert.match(group.disclaimer, /not pooled/);
  assert.equal(group.entities.length, 2);
  // The two entities stay identifiable and separate — no single total is offered.
  assert.notEqual(group.entities[0]?.companyId, group.entities[1]?.companyId);
  assert.ok(!("totalGroupCashCents" in group), "no pooled cash figure is exposed");
});

test("each venue's own cost base drives its own result", () => {
  const avalon = projectYear(AVALON);
  const freshwater = projectYear(FRESHWATER);
  assert.notEqual(avalon.netSalesExGstCents, freshwater.netSalesExGstCents);
  assert.notEqual(avalon.cogsPercent, freshwater.cogsPercent);
  assert.ok(freshwater.grossWagesCents > avalon.grossWagesCents, "Freshwater runs a larger wage bill");
});
