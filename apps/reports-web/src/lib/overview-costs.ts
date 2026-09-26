// The Reports Overview cost triangle — labour, food and prime cost — built
// ONCE, so the headline, the hero tone, the prime panel, the venue table,
// the donut and the trend all describe the same figure. Pure, covered by
// overview-costs.test.ts.
//
// Background: the hero sentence ("Total operating cost is 59.2% … inside the
// guide") read the API's prime cost, which on a weekly window is wages plus
// ACTUAL purchase COGS — and purchases collapse to ~$0 inside a week, so that
// number was really labour alone. The panel beside it recomputed prime from
// wages plus THEORETICAL recipe cost and showed 93.7%. Same screen, two
// definitions, one of them wrong. Everything now reads `buildOverviewCosts`.
//
// Three rules this module enforces, each covered by a test:
//  - prime cost = labour + food cost, and food cost is either ESTIMATED
//    CONSUMPTION (recipe cost × units sold) or STOCKTAKE-SUPPORTED COGS
//    (opening + purchases − closing). Supplier purchases on their own are
//    reported as purchases, never folded into prime.
//  - the venue breakdown reconciles to the group figure: no venue is given a
//    made-up share; a venue without an attributable food cost is shown as
//    such and the unattributed remainder is stated.
//  - a severe cost ratio is a severe cost ratio. "Sales look incomplete"
//    needs evidence about the import (missing days), not a threshold on the
//    ratio itself.

export type CostTone = 'positive' | 'warning' | 'danger' | 'neutral';

// Plain-restaurant cost targets (% of sales). Prime can be overridden
// per-venue by admins; labour and food are fixed guides.
export const COST_TARGETS = { food: 30, labour: 30, prime: 60 } as const;

/** Percent of `denominator`, rounded to one decimal — the API's `pct` rule. */
export function pct(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

/** Tone against a target: at or under is fine, within five points is warm, beyond is hot. */
export function costTone(value: number | null, target: number): CostTone {
  if (value == null) return 'neutral';
  return value <= target ? 'positive' : value <= target + 5 ? 'warning' : 'danger';
}

/**
 * - theoretical: estimated consumption — recipe cost × units sold.
 * - actual: stocktake-supported COGS — opening + purchases − closing, with
 *   invoice coverage the API stands behind.
 * - unavailable: neither exists. Purchases alone never count.
 */
export type OverviewCostBasis = 'theoretical' | 'actual' | 'unavailable';

export type PrimeTotalsInput = {
  salesCents: number;
  wageCents: number;
  cogsCents: number;
  /** Null when supplier invoices do not cover the period. */
  cogsPercent: number | null;
  cogsSource: 'stock_bounded' | 'purchases_only';
  /** Supplier bills (ex-GST) recorded for the period — reported on their own. */
  purchasesCents?: number;
  /** Venue-days with a sales figure; with `expectedSalesDays` this is the import evidence. */
  salesDays?: number;
};

export type PrimeVenueInput = {
  venue: string;
  salesCents: number;
  wageCents: number;
  cogsCents: number;
  cogsPercent: number | null;
  cogsSource?: 'stock_bounded' | 'purchases_only';
};

export type MenuRowInput = {
  venue: string;
  estimatedCogsCents: number | null;
  dataQuality: ReadonlyArray<string>;
};

export type MenuInput = {
  totals: { estimatedCogsCents: number | null };
  rows: MenuRowInput[];
};

export type OverviewVenueCosts = {
  venue: string;
  salesCents: number;
  wageCents: number;
  /** Null when no food cost can be attributed to this venue on the chosen basis. */
  cogsCents: number | null;
  wagePercent: number | null;
  cogsPercent: number | null;
  primeCostPercent: number | null;
};

export type SalesImportQuality = {
  /** Venue-days that carry a sales figure. */
  salesDays: number | null;
  /** Venue-days the period should carry (venues × days), when the caller knows it. */
  expectedSalesDays: number | null;
  /** True only on evidence: fewer sales days than expected. */
  incomplete: boolean;
};

export type OverviewCosts = {
  /** Which food-cost figure is folded into prime, and why. */
  basis: OverviewCostBasis;
  basisLabel: string;
  salesCents: number;
  wageCents: number;
  cogsCents: number | null;
  /** Supplier bills for the period, whatever the basis — never inside prime unless stocktake-supported. */
  purchasesCents: number | null;
  primeCostCents: number | null;
  wagePercent: number | null;
  cogsPercent: number | null;
  primeCostPercent: number | null;
  hasSales: boolean;
  /** Evidence about the sales import, separate from how the costs read. */
  salesImport: SalesImportQuality;
  /** Prime above 100 %: the period lost money on labour + food. A fact, not a data error. */
  lossMaking: boolean;
  venues: OverviewVenueCosts[];
  /**
   * Σ venue cogs + unattributed = group cogs, always. `complete` means every
   * venue has an attributable cost and nothing is left over.
   */
  venueCoverage: 'complete' | 'partial' | 'none';
  venuesWithoutFoodCost: string[];
  unattributedCogsCents: number;
};

const SUSPECT = 'suspect_batch_cost';

/**
 * Prefer THEORETICAL food cost (recipe cost × units sold) — it is live within a
 * week, where actual COGS needs two stocktakes to bracket the period. Fall
 * back to STOCKTAKE-SUPPORTED actual COGS only when the API stands behind its
 * percentage (invoice coverage adequate). Purchases-only figures are exposed
 * as purchases and never become food cost. Otherwise food cost, and therefore
 * prime, is unavailable — never labour alone dressed as the total.
 */
export function buildOverviewCosts(input: {
  totals: PrimeTotalsInput | null;
  venues: PrimeVenueInput[];
  menu: MenuInput | null;
  /** venues × days in the period, when known; enables the import-quality evidence. */
  expectedSalesDays?: number | null;
}): OverviewCosts {
  const venuesIn = input.venues;
  const salesCents = input.totals?.salesCents ?? venuesIn.reduce((sum, row) => sum + row.salesCents, 0);
  const wageCents = input.totals?.wageCents ?? venuesIn.reduce((sum, row) => sum + row.wageCents, 0);
  const hasSales = salesCents > 0;
  const purchasesCents = input.totals?.purchasesCents ?? null;

  // Per-venue theoretical COGS from that venue's own rows, applying the SAME
  // exclusion the API applies to the group total (suspect batch-costed rows
  // are out of both) so the venues can add up to the group.
  const theoreticalByVenue = new Map<string, number>();
  for (const row of input.menu?.rows ?? []) {
    if (row.estimatedCogsCents == null || row.dataQuality.includes(SUSPECT)) continue;
    theoreticalByVenue.set(row.venue, (theoreticalByVenue.get(row.venue) ?? 0) + row.estimatedCogsCents);
  }
  const theoreticalGroup = input.menu?.totals.estimatedCogsCents ?? null;
  const hasTheoretical = theoreticalGroup != null && theoreticalGroup > 0;

  // Stocktake-supported only. A purchases-only figure with a percentage the
  // API is willing to state is still purchases, not consumption.
  const actualStands =
    input.totals != null &&
    input.totals.cogsSource === 'stock_bounded' &&
    input.totals.cogsPercent != null &&
    input.totals.cogsCents > 0;

  let basis: OverviewCostBasis;
  let basisLabel: string;
  let cogsCents: number | null;
  if (hasTheoretical) {
    basis = 'theoretical';
    basisLabel = 'food cost estimated from recipes × units sold';
    cogsCents = theoreticalGroup;
  } else if (actualStands && input.totals) {
    basis = 'actual';
    basisLabel = 'food cost from opening stock + purchases − closing stock';
    cogsCents = input.totals.cogsCents;
  } else {
    basis = 'unavailable';
    basisLabel =
      purchasesCents != null && purchasesCents > 0
        ? 'only supplier bills are recorded, with no stocktake bracketing the period'
        : 'no recipe-mapped sales and no stocktake brackets';
    cogsCents = null;
  }

  // Attribute per venue on the same basis. Nothing is estimated for a venue
  // that has no figure of its own: it is reported as unattributed instead.
  const venues: OverviewVenueCosts[] = venuesIn.map((row) => {
    let venueCogs: number | null;
    if (basis === 'theoretical') {
      venueCogs = theoreticalByVenue.get(row.venue) ?? null;
    } else if (basis === 'actual') {
      venueCogs = (row.cogsSource ?? 'stock_bounded') === 'stock_bounded' && row.cogsPercent != null ? row.cogsCents : null;
    } else {
      venueCogs = null;
    }
    return {
      venue: row.venue,
      salesCents: row.salesCents,
      wageCents: row.wageCents,
      cogsCents: venueCogs,
      wagePercent: pct(row.wageCents, row.salesCents),
      cogsPercent: venueCogs == null ? null : pct(venueCogs, row.salesCents),
      primeCostPercent: venueCogs == null ? null : pct(row.wageCents + venueCogs, row.salesCents)
    };
  });
  const attributedCents = venues.reduce((sum, row) => sum + (row.cogsCents ?? 0), 0);
  const venuesWithoutFoodCost = cogsCents == null ? [] : venues.filter((row) => row.cogsCents == null).map((row) => row.venue);
  const unattributedCogsCents = cogsCents == null ? 0 : cogsCents - attributedCents;
  const venueCoverage: OverviewCosts['venueCoverage'] =
    cogsCents == null || venues.length === 0
      ? 'none'
      : venuesWithoutFoodCost.length === 0 && unattributedCogsCents === 0
        ? 'complete'
        : 'partial';

  const primeCostCents = cogsCents == null ? null : wageCents + cogsCents;
  const primeCostPercent = primeCostCents == null ? null : pct(primeCostCents, salesCents);
  const salesDays = input.totals?.salesDays ?? null;
  const expectedSalesDays = input.expectedSalesDays ?? null;
  return {
    basis,
    basisLabel,
    salesCents,
    wageCents,
    cogsCents,
    purchasesCents,
    primeCostCents,
    wagePercent: pct(wageCents, salesCents),
    cogsPercent: cogsCents == null ? null : pct(cogsCents, salesCents),
    primeCostPercent,
    hasSales,
    salesImport: {
      salesDays,
      expectedSalesDays,
      incomplete: salesDays != null && expectedSalesDays != null && expectedSalesDays > 0 && salesDays < expectedSalesDays
    },
    lossMaking: primeCostPercent != null && primeCostPercent > 100,
    venues,
    venueCoverage,
    venuesWithoutFoodCost,
    unattributedCogsCents
  };
}

export type OverviewNarrative = {
  headline: string;
  sub: string;
  tone: CostTone;
};

/**
 * The hero sentence and its tone, from the SAME figure the panel displays.
 * `periodLabel` is the window the costs were measured over ("this week",
 * "1 Sep to 30 Sep") — the sentence used to say "this week" whatever the
 * period preset was.
 */
export function overviewNarrative(input: {
  costs: OverviewCosts | null;
  primeTarget: number;
  loading: boolean;
  periodLabel: string;
}): OverviewNarrative {
  const { costs, primeTarget, loading, periodLabel } = input;
  const guide = `${primeTarget.toFixed(0)}%`;
  if (loading) return { headline: 'Pulling the numbers together.', sub: 'Loading the period in numbers.', tone: 'neutral' };
  if (!costs || !costs.hasSales) {
    return {
      headline: 'Waiting on the numbers.',
      sub: `No sales recorded for ${periodLabel} yet — enter takings under Enter sales.`,
      tone: 'neutral'
    };
  }
  const labour = costs.wagePercent == null ? '—' : `${costs.wagePercent.toFixed(1)}%`;
  // Import evidence rides along as a caveat; it never replaces the reading.
  const importCaveat = costs.salesImport.incomplete
    ? ` Sales are recorded for ${costs.salesImport.salesDays} of ${costs.salesImport.expectedSalesDays} venue-days, so the ratios overstate cost until the import catches up.`
    : '';
  if (costs.primeCostPercent == null || costs.cogsPercent == null) {
    return {
      headline: 'Labour only so far.',
      sub: `Labour is ${labour} of sales for ${periodLabel}. Food cost is not available for this window (${costs.basisLabel}), so prime cost cannot be read against the ${guide} guide yet.${importCaveat}`,
      tone: costs.salesImport.incomplete ? 'neutral' : costTone(costs.wagePercent, COST_TARGETS.labour) === 'danger' ? 'warning' : 'neutral'
    };
  }
  const prime = costs.primeCostPercent;
  const variance = prime - primeTarget;
  const tone = costs.salesImport.incomplete ? 'neutral' : costTone(prime, primeTarget);
  const food = `${costs.cogsPercent.toFixed(1)}%`;
  const over = variance > 0 ? `${variance.toFixed(1)} pts over` : `${Math.abs(variance).toFixed(1)} pts under`;
  const reading = `Prime cost (labour + food) is ${prime.toFixed(1)}% of sales for ${periodLabel} — labour ${labour} plus food ${food} (${costs.basisLabel}) — ${over} the ${guide} guide.`;
  if (costs.salesImport.incomplete) {
    return { headline: 'Sales import is incomplete.', sub: `${reading}${importCaveat}`, tone };
  }
  if (costs.lossMaking) {
    return { headline: 'Costs exceeded sales.', sub: `${reading} Labour and food together cost more than the period took.`, tone };
  }
  const headline =
    tone === 'danger' ? 'Running hot, worth a look.' : tone === 'warning' ? 'Warm, keep an eye on it.' : 'Inside the guides, good period.';
  return { headline, sub: reading, tone };
}
