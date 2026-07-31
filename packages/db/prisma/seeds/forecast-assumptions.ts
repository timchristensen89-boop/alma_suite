// Seed assumptions for the forecasting module.
//
// PROVENANCE. Every value below is traceable to one of two documents:
//
//   MODEL — "Alma Creditor Model — Corrected v2", Inputs sheet. Full
//           precision. Supersedes "Rebuilt Clean", which is stale.
//   SCHED — "Alma Cost Reduction Schedule", sourced from FY2026 Xero account
//           transactions. Itemises the reductions and the ledger-verified
//           cleaning and software savings.
//   V5    — "Alma Group Indicative Creditor Funding Proposal v5", 30 July 2026,
//           for Cameron Gray, Voluntary Administrator, HM Advisory.
//
// The earlier Freshwater conflict is RESOLVED. Corrected v2 adopts annual sales
// of $1,602,751.93 and an FY2026 software base of $30,524.81 — both the V5
// figures — and its historical stress case now reproduces V5 exactly for both
// entities. V5 was right and "Rebuilt Clean" was stale.
//
// CAUTION: V5 is now itself out of date against corrected v2. V5 states that
// cleaning and software are carried at full FY2026 cost with no saving assumed;
// corrected v2 takes $22,141.81 p.a. of ledger-verified savings, and moves the
// other-operating rates from 7.0%/7.5% to 7.75%/8.25%. Its base and
// conservative cash figures no longer match. The values below follow corrected
// v2, not V5.
//
// These are versioned rows in fc_assumptions, not constants. The forecasting
// services read the active version at a given date; they never import from
// this file at runtime.

/** Dollars → integer cents, rounded half away from zero. */
export const cents = (dollars: number): number =>
  Math.round(Math.abs(dollars) * 100) * Math.sign(dollars || 1);

export type SeedAssumption = {
  key: string;
  valueNumeric?: number;
  valueText?: string;
  unit: string;
  sourceNote: string;
  /** False where the two source documents disagree, or the figure is a proxy. */
  confirmed?: boolean;
};

export type SeedCompany = {
  code: "TCC" | "AF";
  legalName: string;
  tradingName: string;
  venue: { code: string; name: string; legacyVenueName: string };
  assumptions: SeedAssumption[];
  proposal: {
    name: string;
    termMonths: number;
    /**
     * V5 commits a RATE, not a dollar total. Its section 7: "each distribution
     * recalculates automatically if the admitted pool changes, so no
     * renegotiation of the rate is required as claims are adjudicated."
     */
    baseCentsInDollar: number;
    performanceCentsInDollar: number;
    /** Working estimate only — replaced by admitted proofs of debt. */
    estimatedExternalPoolCents: number;
    /** Share of the distribution paid in each proposal year. */
    yearShares: readonly [number, number, number];
    /** Share of each year's amount paid in December; the rest in January. */
    decemberShare: number;
    scheduleNote: string;
  };
};

const MODEL = "Alma Creditor Model — Corrected v2, Inputs sheet.";
const V5 = "Indicative Creditor Funding Proposal v5, 30 Jul 2026.";
const SCHED = "Alma Cost Reduction Schedule, from FY2026 Xero account transactions.";
const BOTH = `${MODEL} Agrees with ${V5}`;

export const SEED_COMPANIES: SeedCompany[] = [
  {
    code: "TCC",
    legalName: "Two Cooked Chooks Pty Ltd",
    tradingName: "Alma Avalon",
    venue: { code: "AVALON", name: "Alma Avalon", legacyVenueName: "Alma Avalon" },
    // Avalon reconciles to the model to the cent on every figure below.
    assumptions: [
      { key: "annual_base_sales", valueNumeric: cents(1_271_589.05), unit: "cents", sourceNote: `${BOTH} FY2026 Xero trading income.`, confirmed: true },
      { key: "annual_growth_percent", valueNumeric: 2, unit: "percent", sourceNote: `${BOTH} Management assumption.`, confirmed: true },
      { key: "cogs_target_percent", valueNumeric: 25.3, unit: "percent", sourceNote: `${BOTH} Of GST-EXCLUSIVE base sales. OPERATING TARGET — below the FY2026 actual of 27.10%, not yet evidenced by stocktake or supplier pricing.`, confirmed: false },
      { key: "gross_wages_weekly", valueNumeric: cents(7_000), unit: "cents_per_week", sourceNote: `${BOTH} GROSS — already contains PAYG withholding, so labour = gross + super only. Below FY2026 payroll; the largest single variance in the forecast.`, confirmed: false },
      { key: "super_percent", valueNumeric: 12, unit: "percent", sourceNote: BOTH, confirmed: true },
      { key: "monthly_rent_ex_gst", valueNumeric: cents(12_828.772727), unit: "cents_per_month", sourceNote: `${BOTH} FY2026 run rate, no adjustment — $153,945 forecast against $154,042 actual.`, confirmed: true },
      { key: "monthly_cleaning", valueNumeric: cents(1_534.246667), unit: "cents_per_month", sourceNote: `${BOTH} FULL FY2026 run rate — no saving assumed.`, confirmed: true },
      { key: "monthly_software", valueNumeric: cents(831.725), unit: "cents_per_month", sourceNote: `${MODEL} FY2026 run rate $1,415.06/mo less $7,000 p.a. of ledger-verified savings (SevenRooms plan change $4,000, Deputy replaced by the in-house platform $3,000). ${SCHED} NOTE: V5 still says full run rate with no saving.`, confirmed: false },
      { key: "other_operating_percent", valueNumeric: 7.75, unit: "percent", sourceNote: `${MODEL} Of base sales. Raised from 7.0% so the revised allowance ($111,264 with maintenance) covers the $107,846 of continuing costs itemised in ${SCHED} V5 Appendix A still shows 7.0%.`, confirmed: true },
      { key: "maintenance_reserve_percent", valueNumeric: 1, unit: "percent", sourceNote: `${BOTH} Of base sales.`, confirmed: true },
      { key: "nab_repayment_monthly", valueNumeric: cents(11_656), unit: "cents_per_month", sourceNote: `${BOTH} Continuing finance commitment.`, confirmed: true },
      { key: "plenti_repayment_monthly", valueNumeric: cents(815.5), unit: "cents_per_month", sourceNote: `${BOTH} Continuing finance commitment.`, confirmed: true },
      { key: "annual_menu_price_uplift", valueNumeric: cents(35_715.891909), unit: "cents", sourceNote: `${BOTH} Square item-volume estimate, net of GST and merchant fees. ESTIMATE.`, confirmed: false },
      { key: "administration_fee_total", valueNumeric: cents(25_000), unit: "cents", sourceNote: `${BOTH} HM Advisory allowance, drawn evenly across the first 12 months. Additional to creditor distributions.`, confirmed: false },
      { key: "opening_cash", valueNumeric: 0, unit: "cents", sourceNote: `${BOTH} Model carries nil; confirm the actual bank balance.`, confirmed: false },
    ],
    proposal: {
      name: "Avalon creditors' proposal (v5)",
      termMonths: 36,
      baseCentsInDollar: 10,
      performanceCentsInDollar: 5,
      estimatedExternalPoolCents: cents(377_369),
      // No year-one distribution: the conservative case dips to -$20,543 in
      // month three before recovering through summer, so an instalment in
      // year one cannot be funded. This is a liquidity constraint, not a
      // deferral request.
      yearShares: [0, 0.35, 0.65],
      decemberShare: 0.4,
      scheduleNote: "No distribution in year one. Base $37,736.90 across Dec 2027, Jan 2028, Dec 2028 and Jan 2029.",
    },
  },
  {
    code: "AF",
    legalName: "Alma Freshwater Pty Ltd",
    tradingName: "St Alma",
    venue: { code: "FRESHWATER", name: "St Alma", legacyVenueName: "St Alma" },
    assumptions: [
      { key: "annual_base_sales", valueNumeric: cents(1_602_751.93), unit: "cents", sourceNote: `${MODEL} FY2026 Xero trading income. RESOLVED — corrected v2 adopts the V5 figure; the earlier "Rebuilt Clean" value of $1,628,470.48 was stale.`, confirmed: true },
      { key: "annual_growth_percent", valueNumeric: 2, unit: "percent", sourceNote: `${BOTH} Management assumption.`, confirmed: true },
      { key: "cogs_target_percent", valueNumeric: 25.5, unit: "percent", sourceNote: `${BOTH} Of GST-EXCLUSIVE base sales. OPERATING TARGET — below the FY2026 actual of 26.79%, not yet evidenced.`, confirmed: false },
      { key: "gross_wages_weekly", valueNumeric: cents(10_000), unit: "cents_per_week", sourceNote: `${BOTH} GROSS — already contains PAYG withholding, so labour = gross + super only.`, confirmed: false },
      { key: "super_percent", valueNumeric: 12, unit: "percent", sourceNote: BOTH, confirmed: true },
      { key: "monthly_rent_ex_gst", valueNumeric: cents(11_067.5), unit: "cents_per_month", sourceNote: `${BOTH} RECURRING BASE RENT only. The FY2026 Xero account of $144,694 also contains outgoings and arrears; the $11,884 difference is an expense reclassification, not a saving. Tie the split to the lease before circulation.`, confirmed: false },
      { key: "monthly_cleaning", valueNumeric: cents(1_794.96), unit: "cents_per_month", sourceNote: `${MODEL} FY2026 run rate $2,552.23/mo less $9,087.28 p.a. — external cleaners (Horizon Cleaning Group) moved to rostered staff. ${SCHED} NOTE: V5 still says full run rate with no saving.`, confirmed: false },
      { key: "monthly_software", valueNumeric: cents(2_039.19), unit: "cents_per_month", sourceNote: `${MODEL} FY2026 base $30,524.81 p.a. (the V5 figure — RESOLVED) less $6,054.53 of ledger-verified savings: Loaded replaced by the in-house platform $3,372.68, SevenRooms plan change $2,681.85. ${SCHED}`, confirmed: false },
      { key: "other_operating_percent", valueNumeric: 8.25, unit: "percent", sourceNote: `${MODEL} Of base sales. Raised from 7.5% so the revised allowance ($148,255 with maintenance) covers the $146,006 of continuing costs itemised in ${SCHED} V5 Appendix A still shows 7.5%.`, confirmed: true },
      { key: "maintenance_reserve_percent", valueNumeric: 1, unit: "percent", sourceNote: `${BOTH} Of base sales.`, confirmed: true },
      { key: "annual_menu_price_uplift", valueNumeric: cents(45_739.975241), unit: "cents", sourceNote: `${BOTH} MANAGEMENT PROXY pending actual Square item quantities — v5 calls it unverified. Contributes roughly $140,000 across the 36 months.`, confirmed: false },
      { key: "administration_fee_total", valueNumeric: cents(25_000), unit: "cents", sourceNote: `${BOTH} HM Advisory allowance, drawn evenly across the first 12 months.`, confirmed: false },
      { key: "opening_cash", valueNumeric: 0, unit: "cents", sourceNote: `${BOTH} Model carries nil; confirm the actual bank balance.`, confirmed: false },
      // No NAB or Plenti repayment is allocated to Freshwater in the standalone model.
    ],
    proposal: {
      name: "Freshwater creditors' proposal (v5)",
      termMonths: 36,
      baseCentsInDollar: 10,
      performanceCentsInDollar: 5,
      estimatedExternalPoolCents: cents(337_915),
      yearShares: [0.2, 0.3, 0.5],
      decemberShare: 0.4,
      scheduleNote: "Base $33,791.50 across six instalments, Dec and Jan of each year, on a 20/30/50 escalating profile.",
    },
  },
];

/**
 * Scenarios seeded for every company, matching the model's conservative-case
 * stresses (Inputs B54:B57) and the case definitions in v5 Appendix A.
 * Adjustments never mutate base assumptions.
 */
export const SEED_SCENARIOS = [
  { key: "BASE", name: "Base", description: "FY2026 revenue with 2% annual growth and the modelled menu-price uplift, at the current operating cost structure.", isDefault: true, adjustments: {} },
  {
    key: "CONSERVATIVE",
    name: "Conservative",
    description: "Sales and menu uplift 10% lower, COGS 2 percentage points higher, labour 2% higher. Rent, cleaning, software, finance and administration unchanged.",
    isDefault: false,
    adjustments: {
      salesPercent: -10,
      menuPriceRealisationPercent: -10,
      cogsPercentagePointDelta: 2,
      labourPercent: 2,
    },
  },
  {
    key: "HISTORICAL_STRESS",
    name: "Historical stress",
    description: "FY2026 revenue and expenses repeat with no growth and no menu-price uplift, with finance commitments continuing. Deliberately stricter than the operating forecast — Avalon is loss-making at -$735,112 over 36 months on this case.",
    isDefault: false,
    adjustments: {
      useHistoricalCostBase: true,
      salesGrowthPercent: 0,
      menuPriceRealisationPercent: -100,
    },
  },
] as const;
