import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildOverviewCosts, costTone, overviewNarrative, pct } from './overview-costs.js';

// The screen that started this: sales $100k, wages $59,200 (59.2%), actual
// purchase COGS inside the week $0, theoretical recipe cost $34,500 (34.5%).
const WEEK = {
  totals: { salesCents: 10_000_000, wageCents: 5_920_000, cogsCents: 0, cogsPercent: 0, cogsSource: 'purchases_only' as const },
  venues: [
    { venue: 'Alma Avalon', salesCents: 6_000_000, wageCents: 3_600_000, cogsCents: 0, cogsPercent: 0 },
    { venue: 'St Alma', salesCents: 4_000_000, wageCents: 2_320_000, cogsCents: 0, cogsPercent: 0 }
  ],
  menu: {
    totals: { estimatedCogsCents: 3_450_000 },
    rows: [
      { venue: 'Alma Avalon', estimatedCogsCents: 2_000_000, dataQuality: ['actual_sales', 'mapped_recipe_cost'] },
      { venue: 'St Alma', estimatedCogsCents: 1_450_000, dataQuality: ['actual_sales', 'mapped_recipe_cost'] },
      // A batch-costed row the API already excluded from its total.
      { venue: 'St Alma', estimatedCogsCents: 900_000, dataQuality: ['actual_sales', 'mapped_recipe_cost', 'suspect_batch_cost'] }
    ]
  }
};

describe('buildOverviewCosts', () => {
  it('folds theoretical food cost into prime, so the total is labour plus food and never labour alone', () => {
    const costs = buildOverviewCosts(WEEK);
    assert.equal(costs.basis, 'theoretical');
    assert.equal(costs.wagePercent, 59.2);
    assert.equal(costs.cogsPercent, 34.5);
    assert.equal(costs.primeCostPercent, 93.7);
    // The displayed components explain the displayed total to rounding.
    assert.ok(Math.abs(costs.wagePercent! + costs.cogsPercent! - costs.primeCostPercent!) <= 0.1);
  });

  it('venue food cost excludes the same suspect rows as the group total, so venues add up to the group', () => {
    const costs = buildOverviewCosts(WEEK);
    const venueSum = costs.venues.reduce((sum, row) => sum + (row.cogsCents ?? 0), 0);
    assert.equal(venueSum, costs.cogsCents);
    assert.equal(costs.venues.find((row) => row.venue === 'St Alma')?.cogsCents, 1_450_000);
  });

  it('a venue with no recipe rows gets a sales-share estimate, not zero', () => {
    const costs = buildOverviewCosts({
      ...WEEK,
      menu: { totals: { estimatedCogsCents: 3_000_000 }, rows: [{ venue: 'Alma Avalon', estimatedCogsCents: 3_000_000, dataQuality: [] }] }
    });
    assert.equal(costs.venues[1]?.cogsCents, 1_200_000);
  });

  it('falls back to actual COGS only when the API stands behind the percentage', () => {
    const covered = buildOverviewCosts({
      totals: { salesCents: 10_000_000, wageCents: 3_000_000, cogsCents: 2_800_000, cogsPercent: 28, cogsSource: 'stock_bounded' },
      venues: [],
      menu: null
    });
    assert.equal(covered.basis, 'actual');
    assert.equal(covered.primeCostPercent, 58);

    // Invoices don't cover the period: the API withholds cogsPercent.
    const uncovered = buildOverviewCosts({
      totals: { salesCents: 10_000_000, wageCents: 3_000_000, cogsCents: 200_000, cogsPercent: null, cogsSource: 'purchases_only' },
      venues: [{ venue: 'Alma Avalon', salesCents: 10_000_000, wageCents: 3_000_000, cogsCents: 200_000, cogsPercent: null }],
      menu: { totals: { estimatedCogsCents: null }, rows: [] }
    });
    assert.equal(uncovered.basis, 'unavailable');
    assert.equal(uncovered.cogsPercent, null);
    assert.equal(uncovered.primeCostPercent, null);
    assert.equal(uncovered.wagePercent, 30);
    assert.equal(uncovered.venues[0]?.primeCostPercent, null);
  });

  it('flags a total above the plausible ceiling as incomplete sales', () => {
    const costs = buildOverviewCosts({
      totals: { salesCents: 1_000_000, wageCents: 900_000, cogsCents: 0, cogsPercent: 0, cogsSource: 'purchases_only' },
      venues: [],
      menu: { totals: { estimatedCogsCents: 400_000 }, rows: [] }
    });
    assert.equal(costs.primeCostPercent, 130);
    assert.equal(costs.incomplete, true);
  });
});

describe('overviewNarrative', () => {
  it('describes the same figure the panel shows, with the tone the panel uses', () => {
    const costs = buildOverviewCosts(WEEK);
    const narrative = overviewNarrative({ costs, primeTarget: 60, loading: false, periodLabel: 'this week' });
    assert.equal(narrative.tone, 'danger');
    assert.equal(narrative.headline, 'Running hot, worth a look.');
    assert.match(narrative.sub, /Total operating cost is 93\.7% of sales/);
    assert.match(narrative.sub, /labour 59\.2% plus food 34\.5%/);
    assert.match(narrative.sub, /33\.7 pts over the 60% guide/);
    assert.equal(narrative.tone, costTone(costs.primeCostPercent, 60));
  });

  it('never calls labour alone the total operating cost', () => {
    const costs = buildOverviewCosts({
      totals: { salesCents: 10_000_000, wageCents: 5_920_000, cogsCents: 0, cogsPercent: null, cogsSource: 'purchases_only' },
      venues: [],
      menu: null
    });
    const narrative = overviewNarrative({ costs, primeTarget: 60, loading: false, periodLabel: 'this week' });
    assert.equal(narrative.headline, 'Labour only so far.');
    assert.doesNotMatch(narrative.sub, /Total operating cost is/);
    assert.match(narrative.sub, /Labour is 59\.2%/);
  });

  it('names the period rather than assuming a week', () => {
    const costs = buildOverviewCosts(WEEK);
    const narrative = overviewNarrative({ costs, primeTarget: 60, loading: false, periodLabel: '1 Sep to 30 Sep' });
    assert.match(narrative.sub, /for 1 Sep to 30 Sep/);
    assert.doesNotMatch(narrative.sub, /this week/);
  });

  it('is neutral while loading and when there are no sales', () => {
    assert.equal(overviewNarrative({ costs: null, primeTarget: 60, loading: true, periodLabel: 'x' }).tone, 'neutral');
    const empty = buildOverviewCosts({ totals: null, venues: [], menu: null });
    assert.equal(overviewNarrative({ costs: empty, primeTarget: 60, loading: false, periodLabel: 'x' }).headline, 'Waiting on the numbers.');
  });
});

describe('pct and costTone', () => {
  it('rounds to one decimal like the API and withholds on a zero denominator', () => {
    assert.equal(pct(5_920_000, 10_000_000), 59.2);
    assert.equal(pct(1, 3), 33.3);
    assert.equal(pct(1, 0), null);
  });

  it('bands against the target, with a five-point warm zone', () => {
    assert.equal(costTone(60, 60), 'positive');
    assert.equal(costTone(64.9, 60), 'warning');
    assert.equal(costTone(65.1, 60), 'danger');
    assert.equal(costTone(null, 60), 'neutral');
    assert.equal(costTone(130, 60), 'neutral');
  });
});
