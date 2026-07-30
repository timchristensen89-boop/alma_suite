// Seed assumptions for the forecasting module.
//
// PROVENANCE. Every value below is traceable to one of two documents:
//
//   MODEL — "Alma Creditor Model — Rebuilt Clean", Inputs sheet. Full
//           precision, the workbook the proposal names as its financial model.
//   V5    — "Alma Group Indicative Creditor Funding Proposal v5", 30 July 2026,
//           prepared for Cameron Gray, Voluntary Administrator, HM Advisory.
//
// Where the two agree, the MODEL value is used because it carries full
// precision. Where they DISAGREE, the V5 value is used — it is the operative
// document, it is the more conservative of the two, and it is what creditors
// would see — and the conflict is recorded in the sourceNote so it is visible
// in the UI rather than buried here.
//
// UNRESOLVED. Avalon reconciles to the model to the cent. Freshwater does NOT:
// the two documents disagree on annual sales ($1,628,470.48 model vs
// $1,602,752 V5) and on software ($2,367.57/mo vs $2,543.73/mo), and V5's
// 36-month cash figures sit $58k–$89k below the model's across all three
// cases. Both cannot be right. Until that is settled against the FY2026 Xero
// P&L, every contested Freshwater row is seeded confirmed = false.
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

const MODEL = "Alma Creditor Model — Rebuilt Clean, Inputs sheet.";
const V5 = "Indicative Creditor Funding Proposal v5, 30 Jul 2026.";
const BOTH = `${MODEL} Agrees with ${V5}`;

/** Flags a figure the two source documents disagree on. */
const CONFLICT = (modelValue: string, v5Value: string) =>
  `CONFLICT — model says ${modelValue}, ${V5} says ${v5Value}. V5 value seeded (operative and more conservative). Settle against the FY2026 Xero P&L.`;

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
      { key: "monthly_software", valueNumeric: cents(1_415.058333), unit: "cents_per_month", sourceNote: `${BOTH} FULL FY2026 run rate — no saving assumed.`, confirmed: true },
      { key: "other_operating_percent", valueNumeric: 7, unit: "percent", sourceNote: `${BOTH} Of base sales.`, confirmed: true },
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
      {
        key: "annual_base_sales",
        valueNumeric: cents(1_602_752),
        unit: "cents",
        sourceNote: CONFLICT("$1,628,470.48", "$1,602,752") + " A $25,718 difference that moves every downstream Freshwater figure.",
        confirmed: false,
      },
      { key: "annual_growth_percent", valueNumeric: 2, unit: "percent", sourceNote: `${BOTH} Management assumption.`, confirmed: true },
      { key: "cogs_target_percent", valueNumeric: 25.5, unit: "percent", sourceNote: `${BOTH} Of GST-EXCLUSIVE base sales. OPERATING TARGET — below the FY2026 actual of 26.79%, not yet evidenced.`, confirmed: false },
      { key: "gross_wages_weekly", valueNumeric: cents(10_000), unit: "cents_per_week", sourceNote: `${BOTH} GROSS — already contains PAYG withholding, so labour = gross + super only.`, confirmed: false },
      { key: "super_percent", valueNumeric: 12, unit: "percent", sourceNote: BOTH, confirmed: true },
      { key: "monthly_rent_ex_gst", valueNumeric: cents(11_067.5), unit: "cents_per_month", sourceNote: `${BOTH} RECURRING BASE RENT only. The FY2026 Xero account of $144,694 also contains outgoings and arrears; the $11,884 difference is an expense reclassification, not a saving. Tie the split to the lease before circulation.`, confirmed: false },
      { key: "monthly_cleaning", valueNumeric: cents(2_552.233333), unit: "cents_per_month", sourceNote: `${BOTH} FULL FY2026 run rate — no saving assumed.`, confirmed: true },
      {
        key: "monthly_software",
        valueNumeric: cents(2_543.73),
        unit: "cents_per_month",
        sourceNote: CONFLICT("$2,367.57/mo ($28,410.81 p.a.)", "$2,543.73/mo ($30,525 p.a.)"),
        confirmed: false,
      },
      { key: "other_operating_percent", valueNumeric: 7.5, unit: "percent", sourceNote: `${BOTH} Of base sales.`, confirmed: true },
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
