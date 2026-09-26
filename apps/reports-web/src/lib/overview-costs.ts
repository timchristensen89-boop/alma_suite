// The Reports Overview cost triangle — labour, food and prime (total
// operating) cost — built ONCE, so the headline, the hero tone, the prime
// panel, the venue table, the donut and the trend all describe the same
// figure. Pure, covered by overview-costs.test.ts.
//
// Background: the hero sentence ("Total operating cost is 59.2% … inside the
// guide") read the API's prime cost, which on a weekly window is wages plus
// ACTUAL purchase COGS — and purchases collapse to ~$0 inside a week, so that
// number was really labour alone. The panel beside it recomputed prime from
// wages plus THEORETICAL recipe cost and showed 93.7%. Same screen, two
// definitions, one of them wrong. Everything now reads `buildOverviewCosts`.

export type CostTone = 'positive' | 'warning' | 'danger' | 'neutral';

// Plain-restaurant cost targets (% of sales). Prime can be overridden
// per-venue by admins; labour and food are fixed guides.
export const COST_TARGETS = { food: 30, labour: 30, prime: 60 } as const;

// A cost ratio above this can't happen in a trading restaurant — it means
// sales didn't fully import for the window. Say so instead of a false red.
export const IMPLAUSIBLE_COST_PCT = 120;

/** Percent of `denominator`, rounded to one decimal — the API's `pct` rule. */
export function pct(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

/** Tone against a target: at or under is fine, within five points is warm, beyond is hot. */
export function costTone(value: number | null, target: number): CostTone {
  if (value == null) return 'neutral';
  if (value > IMPLAUSIBLE_COST_PCT) return 'neutral';
  return value <= target ? 'positive' : value <= target + 5 ? 'warning' : 'danger';
}

export type OverviewCostBasis = 'theoretical' | 'actual' | 'unavailable';

export type PrimeTotalsInput = {
  salesCents: number;
  wageCents: number;
  cogsCents: number;
  /** Null when supplier invoices do not cover the period. */
  cogsPercent: number | null;
  cogsSource: 'stock_bounded' | 'purchases_only';
};

export type PrimeVenueInput = {
  venue: string;
  salesCents: number;
  wageCents: number;
  cogsCents: number;
  cogsPercent: number | null;
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
  cogsCents: number | null;
  wagePercent: number | null;
  cogsPercent: number | null;
  primeCostPercent: number | null;
};

export type OverviewCosts = {
  /** Which food-cost figure is folded into prime, and why. */
  basis: OverviewCostBasis;
  basisLabel: string;
  salesCents: number;
  wageCents: number;
  cogsCents: number | null;
  primeCostCents: number | null;
  wagePercent: number | null;
  cogsPercent: number | null;
  primeCostPercent: number | null;
  hasSales: boolean;
  /** Prime above the plausible ceiling — sales look short for the window. */
  incomplete: boolean;
  venues: OverviewVenueCosts[];
};

const SUSPECT = 'suspect_batch_cost';

/**
 * Prefer THEORETICAL food cost (recipe cost × units sold) — it is live within a
 * week, where actual COGS needs two stocktakes to bracket the period. Fall
 * back to the API's actual COGS only when it is a percentage the API stands
 * behind (invoice coverage is adequate). Otherwise food cost, and therefore
 * prime, is unavailable — never labour alone dressed as the total.
 */
export function buildOverviewCosts(input: {
  totals: PrimeTotalsInput | null;
  venues: PrimeVenueInput[];
  menu: MenuInput | null;
}): OverviewCosts {
  const venuesIn = input.venues;
  const salesCents = input.totals?.salesCents ?? venuesIn.reduce((sum, row) => sum + row.salesCents, 0);
  const wageCents = input.totals?.wageCents ?? venuesIn.reduce((sum, row) => sum + row.wageCents, 0);
  const hasSales = salesCents > 0;

  // Per-venue theoretical COGS from that venue's own rows, applying the SAME
  // exclusion the API applies to the group total (suspect batch-costed rows
  // are out of both) so the venues add up to the group.
  const theoreticalByVenue = new Map<string, number>();
  for (const row of input.menu?.rows ?? []) {
    if (row.estimatedCogsCents == null || row.dataQuality.includes(SUSPECT)) continue;
    theoreticalByVenue.set(row.venue, (theoreticalByVenue.get(row.venue) ?? 0) + row.estimatedCogsCents);
  }
  const theoreticalGroup = input.menu?.totals.estimatedCogsCents ?? null;
  const hasTheoretical = theoreticalGroup != null && theoreticalGroup > 0;

  const actualPercentStands = input.totals != null && input.totals.cogsPercent != null && input.totals.cogsCents > 0;

  let basis: OverviewCostBasis;
  let basisLabel: string;
  let cogsCents: number | null;
  if (hasTheoretical) {
    basis = 'theoretical';
    basisLabel = 'food cost estimated from recipes × units sold';
    cogsCents = theoreticalGroup;
  } else if (actualPercentStands && input.totals) {
    basis = 'actual';
    basisLabel =
      input.totals.cogsSource === 'stock_bounded'
        ? 'food cost from opening stock + purchases − closing stock'
        : 'food cost from supplier bills recorded for the period';
    cogsCents = input.totals.cogsCents;
  } else {
    basis = 'unavailable';
    basisLabel = 'food cost not available for this window';
    cogsCents = null;
  }

  const venues: OverviewVenueCosts[] = venuesIn.map((row) => {
    let venueCogs: number | null;
    if (basis === 'theoretical') {
      const own = theoreticalByVenue.get(row.venue);
      venueCogs =
        own != null
          ? own
          : salesCents > 0 && cogsCents != null
            ? Math.round(cogsCents * (row.salesCents / salesCents))
            : null;
    } else if (basis === 'actual') {
      venueCogs = row.cogsPercent != null ? row.cogsCents : null;
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

  const primeCostCents = cogsCents == null ? null : wageCents + cogsCents;
  const primeCostPercent = primeCostCents == null ? null : pct(primeCostCents, salesCents);
  return {
    basis,
    basisLabel,
    salesCents,
    wageCents,
    cogsCents,
    primeCostCents,
    wagePercent: pct(wageCents, salesCents),
    cogsPercent: cogsCents == null ? null : pct(cogsCents, salesCents),
    primeCostPercent,
    hasSales,
    incomplete: primeCostPercent != null && primeCostPercent > IMPLAUSIBLE_COST_PCT,
    venues
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
  if (costs.incomplete) {
    return {
      headline: 'Sales look short, check the import.',
      sub: `Costs come to more than ${IMPLAUSIBLE_COST_PCT}% of sales for ${periodLabel} — check the Square import before trusting the cost %.`,
      tone: 'neutral'
    };
  }
  const labour = costs.wagePercent == null ? '—' : `${costs.wagePercent.toFixed(1)}%`;
  if (costs.primeCostPercent == null || costs.cogsPercent == null) {
    return {
      headline: 'Labour only so far.',
      sub: `Labour is ${labour} of sales for ${periodLabel}. Food cost is not available for this window (no recipe-mapped sales and no stocktake brackets), so total operating cost cannot be read against the ${guide} guide yet.`,
      tone: costTone(costs.wagePercent, COST_TARGETS.labour) === 'danger' ? 'warning' : 'neutral'
    };
  }
  const prime = costs.primeCostPercent;
  const variance = prime - primeTarget;
  const tone = costTone(prime, primeTarget);
  const headline =
    tone === 'danger' ? 'Running hot, worth a look.' : tone === 'warning' ? 'Warm, keep an eye on it.' : 'Inside the guides, good period.';
  const food = `${costs.cogsPercent.toFixed(1)}%`;
  const over = variance > 0 ? `${variance.toFixed(1)} pts over` : `${Math.abs(variance).toFixed(1)} pts under`;
  return {
    headline,
    sub: `Total operating cost is ${prime.toFixed(1)}% of sales for ${periodLabel} — labour ${labour} plus food ${food} (${costs.basisLabel}) — ${over} the ${guide} guide.`,
    tone
  };
}
