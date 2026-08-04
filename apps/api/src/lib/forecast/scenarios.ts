// Scenario modelling.
//
// A scenario NEVER mutates the base assumptions. It produces a derived set,
// leaving the base intact, so two scenarios evaluated in the same session
// cannot contaminate each other — and so the BASE case is always recoverable
// exactly.
//
// Entity separation holds here too: a scenario is applied per company. There
// is no "group scenario" that pools cash.

export interface AssumptionSet {
  annualBaseSalesCents: number;
  annualGrowthPercent: number;
  menuPriceUpliftPerItemCents: number;
  menuPriceRealisationPercent: number;
  grossWagesWeeklyCents: number;
  superPercent: number;
  cogsTargetPercent: number;
  monthlyRentExGstCents: number;
  monthlyCleaningCents: number;
  monthlySoftwareCents: number;
  otherOperatingPercent: number;
  maintenanceReservePercent: number;
  financeRepaymentsMonthlyCents: number;
  administrationFeeTotalCents: number;
  openingCashCents: number;
  netGstReservePercent: number;
}

/** Every adjustment a scenario may make. All optional; absent means unchanged. */
export interface ScenarioAdjustments {
  salesPercent?: number;
  transactionCountPercent?: number;
  averageSpendPercent?: number;
  menuPriceRealisationPercent?: number;
  /** Percentage POINTS added to the COGS target, not a relative change. */
  cogsPercentagePointDelta?: number;
  labourPercent?: number;
  superPercentDelta?: number;
  rentPercent?: number;
  cleaningPercent?: number;
  softwarePercent?: number;
  utilitiesPercent?: number;
  maintenancePercent?: number;
  otherOperatingPercentDelta?: number;
  financeRepaymentsPercent?: number;
  administrationFeeCents?: number;
  openingCashCents?: number;
  /** Shift supplier payment timing, in days. Positive = pay later. */
  supplierTermsDaysDelta?: number;
  /** Shift receipt timing, in days. */
  receiptTimingDaysDelta?: number;
  creditorContributionCents?: number;
  capitalExpenditureCents?: number;
  /** Trading days removed from the period (closures). */
  closureDays?: number;
  tradingDaysPerWeek?: number;
}

export interface ScenarioDefinition {
  key: string;
  name: string;
  description: string;
  adjustments: ScenarioAdjustments;
}

const applyPercent = (value: number, percent: number | undefined): number =>
  percent === undefined ? value : Math.round(value * (1 + percent / 100));

/**
 * Derive a scenario's assumptions from the base.
 *
 * Returns a NEW object — the base is never touched, which is what keeps
 * scenario comparison honest.
 */
export function applyScenario(base: AssumptionSet, adjustments: ScenarioAdjustments): AssumptionSet {
  const salesAfterVolume = applyPercent(base.annualBaseSalesCents, adjustments.salesPercent);

  // Transaction count and average spend compound into sales when supplied.
  const salesAfterMix = Math.round(
    salesAfterVolume *
      (1 + (adjustments.transactionCountPercent ?? 0) / 100) *
      (1 + (adjustments.averageSpendPercent ?? 0) / 100),
  );

  // Closures remove trading days proportionally across the year.
  const tradingDayFactor =
    adjustments.closureDays && adjustments.closureDays > 0 ? Math.max(0, 1 - adjustments.closureDays / 365) : 1;

  return {
    annualBaseSalesCents: Math.round(salesAfterMix * tradingDayFactor),
    annualGrowthPercent: base.annualGrowthPercent,
    menuPriceUpliftPerItemCents: base.menuPriceUpliftPerItemCents,
    menuPriceRealisationPercent: Math.max(
      0,
      base.menuPriceRealisationPercent + (adjustments.menuPriceRealisationPercent ?? 0),
    ),
    grossWagesWeeklyCents: applyPercent(base.grossWagesWeeklyCents, adjustments.labourPercent),
    superPercent: Math.max(0, base.superPercent + (adjustments.superPercentDelta ?? 0)),
    cogsTargetPercent: Math.max(0, base.cogsTargetPercent + (adjustments.cogsPercentagePointDelta ?? 0)),
    monthlyRentExGstCents: applyPercent(base.monthlyRentExGstCents, adjustments.rentPercent),
    monthlyCleaningCents: applyPercent(base.monthlyCleaningCents, adjustments.cleaningPercent),
    monthlySoftwareCents: applyPercent(base.monthlySoftwareCents, adjustments.softwarePercent),
    otherOperatingPercent: Math.max(0, base.otherOperatingPercent + (adjustments.otherOperatingPercentDelta ?? 0)),
    maintenanceReservePercent: base.maintenanceReservePercent,
    financeRepaymentsMonthlyCents: applyPercent(base.financeRepaymentsMonthlyCents, adjustments.financeRepaymentsPercent),
    administrationFeeTotalCents: adjustments.administrationFeeCents ?? base.administrationFeeTotalCents,
    openingCashCents: adjustments.openingCashCents ?? base.openingCashCents,
    netGstReservePercent: base.netGstReservePercent,
  };
}

export interface AnnualProjection {
  /** GST EXCLUSIVE. */
  netSalesExGstCents: number;
  cogsCents: number;
  grossWagesCents: number;
  superCents: number;
  labourCents: number;
  rentCents: number;
  cleaningCents: number;
  softwareCents: number;
  otherOperatingCents: number;
  maintenanceCents: number;
  financeRepaymentsCents: number;
  administrationCents: number;
  /** Before any creditor contribution. */
  freeCashCents: number;
  cogsPercent: number;
  labourPercent: number;
  primeCostPercent: number;
}

/**
 * A single trading year on GST-EXCLUSIVE figures.
 *
 * The menu-price uplift is applied as a realisation-weighted percentage of
 * sales, not as a flat add — a $1 rise across chargeable items is only worth
 * what customers actually pay.
 */
export function projectYear(
  assumptions: AssumptionSet,
  options: { yearIndex?: number; menuUpliftSalesPercent?: number } = {},
): AnnualProjection {
  const yearIndex = options.yearIndex ?? 0;
  const growthFactor = (1 + assumptions.annualGrowthPercent / 100) ** yearIndex;

  const upliftPercent =
    (options.menuUpliftSalesPercent ?? 0) * (assumptions.menuPriceRealisationPercent / 100);

  const netSales = Math.round(assumptions.annualBaseSalesCents * growthFactor * (1 + upliftPercent / 100));

  const cogs = Math.round(netSales * (assumptions.cogsTargetPercent / 100));
  const grossWages = assumptions.grossWagesWeeklyCents * 52;
  const superCents = Math.round(grossWages * (assumptions.superPercent / 100));
  const labour = grossWages + superCents;
  const rent = assumptions.monthlyRentExGstCents * 12;
  const cleaning = assumptions.monthlyCleaningCents * 12;
  const software = assumptions.monthlySoftwareCents * 12;
  const otherOperating = Math.round(netSales * (assumptions.otherOperatingPercent / 100));
  const maintenance = Math.round(netSales * (assumptions.maintenanceReservePercent / 100));
  const finance = assumptions.financeRepaymentsMonthlyCents * 12;
  // The administration fee is spread over the first 12 months only.
  const administration = yearIndex === 0 ? assumptions.administrationFeeTotalCents : 0;

  const freeCash =
    netSales - cogs - labour - rent - cleaning - software - otherOperating - maintenance - finance - administration;

  const pct = (value: number) => (netSales > 0 ? Math.round((value / netSales) * 100 * 10_000) / 10_000 : 0);

  return {
    netSalesExGstCents: netSales,
    cogsCents: cogs,
    grossWagesCents: grossWages,
    superCents,
    labourCents: labour,
    rentCents: rent,
    cleaningCents: cleaning,
    softwareCents: software,
    otherOperatingCents: otherOperating,
    maintenanceCents: maintenance,
    financeRepaymentsCents: finance,
    administrationCents: administration,
    freeCashCents: freeCash,
    cogsPercent: pct(cogs),
    labourPercent: pct(labour),
    primeCostPercent: pct(cogs + labour),
  };
}

export interface ScenarioComparison {
  scenarioKey: string;
  scenarioName: string;
  years: AnnualProjection[];
  totalFreeCashCents: number;
  /** Worst annual free cash across the term. */
  lowestAnnualFreeCashCents: number;
  /** Years where free cash is negative. */
  warningYears: number[];
}

/** Run a scenario over N years. */
export function runScenario(
  scenario: ScenarioDefinition,
  base: AssumptionSet,
  options: { years?: number; menuUpliftSalesPercent?: number } = {},
): ScenarioComparison {
  const years = options.years ?? 3;
  const assumptions = applyScenario(base, scenario.adjustments);
  const projections: AnnualProjection[] = [];

  for (let index = 0; index < years; index += 1) {
    projections.push(projectYear(assumptions, { yearIndex: index, menuUpliftSalesPercent: options.menuUpliftSalesPercent }));
  }

  const freeCashByYear = projections.map((year) => year.freeCashCents);
  return {
    scenarioKey: scenario.key,
    scenarioName: scenario.name,
    years: projections,
    totalFreeCashCents: freeCashByYear.reduce((sum, value) => sum + value, 0),
    lowestAnnualFreeCashCents: Math.min(...freeCashByYear),
    warningYears: projections.map((year, index) => (year.freeCashCents < 0 ? index + 1 : -1)).filter((index) => index > 0),
  };
}

/** The three default scenarios from the brief. */
export const DEFAULT_SCENARIOS: ScenarioDefinition[] = [
  { key: "BASE", name: "Base", description: "Current best forecast.", adjustments: {} },
  {
    key: "CONSERVATIVE",
    name: "Conservative",
    description: "Sales 10% below base, COGS 2 points higher, labour 2% higher, menu-price realisation reduced by 10%.",
    adjustments: { salesPercent: -10, cogsPercentagePointDelta: 2, labourPercent: 2, menuPriceRealisationPercent: -10 },
  },
  {
    key: "RECOVERY",
    name: "Recovery",
    description: "Sales 5% above base, menu-price realisation 5% stronger.",
    adjustments: { salesPercent: 5, menuPriceRealisationPercent: 5 },
  },
];

/**
 * Compare scenarios side by side for ONE company.
 *
 * Takes a companyId so a comparison cannot silently mix entities: the caller
 * must run it twice to compare two companies, and the result is labelled as a
 * comparison rather than a pooled position.
 */
export function compareScenarios(
  companyId: string,
  base: AssumptionSet,
  scenarios: ScenarioDefinition[],
  options: { years?: number; menuUpliftSalesPercent?: number } = {},
): { companyId: string; comparisons: ScenarioComparison[]; isPooled: false } {
  return {
    companyId,
    comparisons: scenarios.map((scenario) => runScenario(scenario, base, options)),
    isPooled: false,
  };
}

/**
 * A group view. Explicitly a COMPARISON, never a pooled legal or cash
 * position — the flag and the per-entity breakdown are part of the contract.
 */
export function groupComparison(
  entries: Array<{ companyId: string; companyName: string; comparison: ScenarioComparison }>,
): {
  isComparisonOnly: true;
  disclaimer: string;
  entities: Array<{ companyId: string; companyName: string; totalFreeCashCents: number }>;
} {
  return {
    isComparisonOnly: true,
    disclaimer:
      "Comparison only. These are separate legal entities — cash, creditors and liabilities are not pooled, and these totals must not be treated as group funds.",
    entities: entries.map((entry) => ({
      companyId: entry.companyId,
      companyName: entry.companyName,
      totalFreeCashCents: entry.comparison.totalFreeCashCents,
    })),
  };
}
