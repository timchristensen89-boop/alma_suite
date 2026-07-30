// Seed assumptions for the forecasting module.
//
// PROVENANCE: every value here is MANAGEMENT_ASSUMPTION taken from the written
// brief, seeded with confirmed = false. The revised creditor workbook named as
// the seed and verification source was NOT supplied, so nothing below has been
// reconciled against it. Do not present these as verified figures.
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
};

export type SeedCompany = {
  code: "TCC" | "AF";
  legalName: string;
  tradingName: string;
  venue: { code: string; name: string; legacyVenueName: string };
  assumptions: SeedAssumption[];
  proposal: {
    name: string;
    fixedTotalCents: number;
    termMonths: number;
    performanceSharePercent: number;
    performanceCapCents: number;
    /** Fixed distribution per proposal year. */
    yearlyFixedCents: [number, number, number];
    /** Estimated external pool, editable as proofs of debt are admitted. */
    estimatedExternalPoolCents?: number;
  };
};

const BRIEF = "Written brief, 2026-07. Not reconciled to the creditor workbook.";

export const SEED_COMPANIES: SeedCompany[] = [
  {
    code: "TCC",
    legalName: "Two Cooked Chooks Pty Ltd",
    tradingName: "Alma Avalon",
    venue: { code: "AVALON", name: "Alma Avalon", legacyVenueName: "Alma Avalon" },
    assumptions: [
      { key: "annual_base_sales", valueNumeric: cents(1_271_589.05), unit: "cents", sourceNote: BRIEF },
      { key: "annual_growth_percent", valueNumeric: 2, unit: "percent", sourceNote: BRIEF },
      { key: "menu_price_uplift_per_item", valueNumeric: cents(1), unit: "cents", sourceNote: `${BRIEF} Applies to chargeable menu items.` },
      { key: "menu_price_realisation_percent", valueNumeric: 100, unit: "percent", sourceNote: "Assumes full realisation; conservative scenario discounts by 10%." },
      { key: "gross_wages_weekly", valueNumeric: cents(7_000), unit: "cents_per_week", sourceNote: `${BRIEF} GROSS — already contains PAYG withholding.` },
      { key: "super_percent", valueNumeric: 12, unit: "percent", sourceNote: BRIEF },
      { key: "cogs_target_percent", valueNumeric: 25.3, unit: "percent", sourceNote: `${BRIEF} Of GST-EXCLUSIVE base sales.` },
      { key: "monthly_rent_ex_gst", valueNumeric: cents(12_828.77), unit: "cents_per_month", sourceNote: BRIEF },
      { key: "monthly_cleaning", valueNumeric: cents(614), unit: "cents_per_month", sourceNote: `${BRIEF} Approximate, after the current saving plan.` },
      { key: "monthly_software", valueNumeric: cents(609), unit: "cents_per_month", sourceNote: `${BRIEF} Includes OpenTable, excludes SevenRooms.` },
      { key: "other_operating_percent", valueNumeric: 7, unit: "percent", sourceNote: `${BRIEF} Of base sales.` },
      { key: "maintenance_reserve_percent", valueNumeric: 1, unit: "percent", sourceNote: `${BRIEF} Of base sales.` },
      { key: "nab_repayment_monthly", valueNumeric: cents(11_656), unit: "cents_per_month", sourceNote: BRIEF },
      { key: "plenti_repayment_monthly", valueNumeric: cents(815.5), unit: "cents_per_month", sourceNote: BRIEF },
      { key: "administration_fee_total", valueNumeric: cents(25_000), unit: "cents", sourceNote: `${BRIEF} Over the first 12 months. Assumed funded from operating cash.` },
      { key: "opening_cash", valueNumeric: 0, unit: "cents", sourceNote: "Editable. Default zero until a bank balance is confirmed." },
      { key: "net_gst_reserve_percent", valueNumeric: 5.82, unit: "percent", sourceNote: "Of GROSS receipts, from available BAS periods. Fallback timing assumption only — prefer actual BAS." },
    ],
    proposal: {
      name: "Avalon creditors' proposal",
      fixedTotalCents: cents(100_000),
      termMonths: 36,
      performanceSharePercent: 25,
      performanceCapCents: cents(125_000),
      yearlyFixedCents: [cents(20_000), cents(30_000), cents(50_000)],
    },
  },
  {
    code: "AF",
    legalName: "Alma Freshwater Pty Ltd",
    tradingName: "St Alma",
    venue: { code: "FRESHWATER", name: "St Alma", legacyVenueName: "St Alma" },
    assumptions: [
      { key: "annual_base_sales", valueNumeric: cents(1_628_470.48), unit: "cents", sourceNote: BRIEF },
      { key: "annual_growth_percent", valueNumeric: 2, unit: "percent", sourceNote: BRIEF },
      { key: "menu_price_uplift_per_item", valueNumeric: cents(1), unit: "cents", sourceNote: `${BRIEF} Applies to chargeable menu items.` },
      { key: "menu_price_realisation_percent", valueNumeric: 100, unit: "percent", sourceNote: "Assumes full realisation; conservative scenario discounts by 10%." },
      { key: "gross_wages_weekly", valueNumeric: cents(9_000), unit: "cents_per_week", sourceNote: `${BRIEF} GROSS — already contains PAYG withholding.` },
      { key: "super_percent", valueNumeric: 12, unit: "percent", sourceNote: BRIEF },
      { key: "cogs_target_percent", valueNumeric: 25.5, unit: "percent", sourceNote: `${BRIEF} Of GST-EXCLUSIVE base sales.` },
      { key: "monthly_rent_ex_gst", valueNumeric: cents(11_067.5), unit: "cents_per_month", sourceNote: BRIEF },
      { key: "monthly_cleaning", valueNumeric: cents(1_021), unit: "cents_per_month", sourceNote: `${BRIEF} Approximate, after the current saving plan.` },
      { key: "monthly_software", valueNumeric: cents(689), unit: "cents_per_month", sourceNote: `${BRIEF} Includes OpenTable, excludes SevenRooms.` },
      { key: "other_operating_percent", valueNumeric: 7.5, unit: "percent", sourceNote: `${BRIEF} Of base sales.` },
      { key: "maintenance_reserve_percent", valueNumeric: 1, unit: "percent", sourceNote: `${BRIEF} Of base sales.` },
      { key: "administration_fee_total", valueNumeric: cents(25_000), unit: "cents", sourceNote: `${BRIEF} Over the first 12 months.` },
      { key: "opening_cash", valueNumeric: 0, unit: "cents", sourceNote: "Editable. Default zero until a bank balance is confirmed." },
      { key: "net_gst_reserve_percent", valueNumeric: 6.1, unit: "percent", sourceNote: "Of GROSS receipts, from four historical BAS periods. Fallback timing assumption only." },
      // No NAB or Plenti repayment is allocated to Freshwater in the standalone model.
    ],
    proposal: {
      name: "Freshwater creditors' proposal",
      fixedTotalCents: cents(250_000),
      termMonths: 36,
      performanceSharePercent: 25,
      performanceCapCents: cents(100_000),
      yearlyFixedCents: [cents(60_000), cents(85_000), cents(105_000)],
      estimatedExternalPoolCents: cents(337_915),
    },
  },
];

/** Scenarios seeded for every company. Adjustments never mutate base assumptions. */
export const SEED_SCENARIOS = [
  { key: "BASE", name: "Base", description: "Current best forecast.", isDefault: true, adjustments: {} },
  {
    key: "CONSERVATIVE",
    name: "Conservative",
    description: "Sales 10% below base, COGS 2pts higher, labour 2% higher, menu-price realisation reduced by 10%.",
    isDefault: false,
    adjustments: {
      salesPercent: -10,
      cogsPercentagePointDelta: 2,
      labourPercent: 2,
      menuPriceRealisationPercent: -10,
    },
  },
  {
    key: "RECOVERY",
    name: "Recovery",
    description: "Sales 5% above base, menu-price realisation 5% stronger.",
    isDefault: false,
    adjustments: { salesPercent: 5, menuPriceRealisationPercent: 5 },
  },
] as const;
