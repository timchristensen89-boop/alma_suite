import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildOverviewCosts, costTone, overviewNarrative, pct, type OverviewCosts } from './overview-costs.js';

// The screen that started this: sales $100k, wages $59,200 (59.2%), actual
// purchase COGS inside the week $0, theoretical recipe cost $34,500 (34.5%).
const WEEK = {
  totals: { salesCents: 10_000_000, wageCents: 5_920_000, cogsCents: 0, cogsPercent: 0, cogsSource: 'purchases_only' as const, purchasesCents: 0 },
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

// The relationship every breakdown must honour: what the venue rows show,
// plus what is stated as unattributed, IS the group figure.
function assertVenuesReconcile(costs: OverviewCosts) {
  const attributed = costs.venues.reduce((sum, row) => sum + (row.cogsCents ?? 0), 0);
  assert.equal(attributed + costs.unattributedCogsCents, costs.cogsCents ?? 0);
  if (costs.venueCoverage === 'complete') {
    assert.equal(costs.unattributedCogsCents, 0);
    assert.equal(costs.venuesWithoutFoodCost.length, 0);
  }
}

describe('prime cost = labour + food, with the components on screen', () => {
  it('folds theoretical food cost into prime, so the total is labour plus food and never labour alone', () => {
    const costs = buildOverviewCosts(WEEK);
    assert.equal(costs.basis, 'theoretical');
    assert.equal(costs.wagePercent, 59.2);
    assert.equal(costs.cogsPercent, 34.5);
    assert.equal(costs.primeCostPercent, 93.7);
    assert.ok(Math.abs(costs.wagePercent! + costs.cogsPercent! - costs.primeCostPercent!) <= 0.1);
    assert.equal(costs.primeCostCents, costs.wageCents + costs.cogsCents!);
  });
});

describe('venue breakdown reconciles to the group', () => {
  it('excludes the same suspect rows per venue as the group total, so venues add up exactly', () => {
    const costs = buildOverviewCosts(WEEK);
    assertVenuesReconcile(costs);
    assert.equal(costs.venueCoverage, 'complete');
    assert.equal(costs.venues.find((row) => row.venue === 'St Alma')?.cogsCents, 1_450_000);
  });

  it('never fabricates a share for a venue with no recipe rows: it is reported as unattributed', () => {
    // $30,000 of Avalon cost is the whole group figure. St Alma has no rows.
    const costs = buildOverviewCosts({
      ...WEEK,
      menu: { totals: { estimatedCogsCents: 3_000_000 }, rows: [{ venue: 'Alma Avalon', estimatedCogsCents: 3_000_000, dataQuality: [] }] }
    });
    const stAlma = costs.venues.find((row) => row.venue === 'St Alma')!;
    assert.equal(stAlma.cogsCents, null);
    assert.equal(stAlma.cogsPercent, null);
    assert.equal(stAlma.primeCostPercent, null);
    assert.equal(costs.venueCoverage, 'partial');
    assert.deepEqual(costs.venuesWithoutFoodCost, ['St Alma']);
    assertVenuesReconcile(costs);
    // The old sales-share estimate put $12,000 on St Alma and left venues at
    // $42,000 against a $30,000 group. That can never happen now.
    assert.equal(costs.venues.reduce((sum, row) => sum + (row.cogsCents ?? 0), 0), 3_000_000);
  });

  it('states the remainder when menu rows belong to a venue that has no sales row', () => {
    const costs = buildOverviewCosts({
      ...WEEK,
      menu: {
        totals: { estimatedCogsCents: 3_450_000 },
        rows: [
          { venue: 'Alma Avalon', estimatedCogsCents: 2_000_000, dataQuality: [] },
          { venue: 'Functions / Pop-up', estimatedCogsCents: 1_450_000, dataQuality: [] }
        ]
      }
    });
    assert.equal(costs.unattributedCogsCents, 1_450_000);
    assert.equal(costs.venueCoverage, 'partial');
    assertVenuesReconcile(costs);
  });
});

describe('purchases are not consumption', () => {
  it('a purchases-only figure with a stated percentage still does not become food cost in prime', () => {
    // Invoices cover the period (so the API states a %), but no stocktake
    // brackets it: $2,000 of bills is what was BOUGHT, not what was USED.
    const costs = buildOverviewCosts({
      totals: { salesCents: 10_000_000, wageCents: 3_000_000, cogsCents: 200_000, cogsPercent: 2, cogsSource: 'purchases_only', purchasesCents: 200_000 },
      venues: [{ venue: 'Alma Avalon', salesCents: 10_000_000, wageCents: 3_000_000, cogsCents: 200_000, cogsPercent: 2, cogsSource: 'purchases_only' }],
      menu: null
    });
    assert.equal(costs.basis, 'unavailable');
    assert.equal(costs.cogsCents, null);
    assert.equal(costs.primeCostPercent, null);
    assert.equal(costs.purchasesCents, 200_000);
    assert.equal(costs.wagePercent, 30);
    assert.equal(costs.venues[0]?.primeCostPercent, null);
    assert.match(costs.basisLabel, /supplier bills/);
  });

  it('stocktake-supported COGS with adequate coverage is the actual basis', () => {
    const costs = buildOverviewCosts({
      totals: { salesCents: 10_000_000, wageCents: 3_000_000, cogsCents: 2_800_000, cogsPercent: 28, cogsSource: 'stock_bounded', purchasesCents: 2_500_000 },
      venues: [{ venue: 'Alma Avalon', salesCents: 10_000_000, wageCents: 3_000_000, cogsCents: 2_800_000, cogsPercent: 28, cogsSource: 'stock_bounded' }],
      menu: null
    });
    assert.equal(costs.basis, 'actual');
    assert.equal(costs.primeCostPercent, 58);
    assert.equal(costs.purchasesCents, 2_500_000);
    assertVenuesReconcile(costs);
    assert.equal(costs.venueCoverage, 'complete');
  });

  it('a stocktake-bounded figure whose invoice coverage the API withholds is still unavailable', () => {
    const costs = buildOverviewCosts({
      totals: { salesCents: 10_000_000, wageCents: 3_000_000, cogsCents: 2_800_000, cogsPercent: null, cogsSource: 'stock_bounded' },
      venues: [],
      menu: null
    });
    assert.equal(costs.basis, 'unavailable');
    assert.equal(costs.primeCostPercent, null);
  });
});

describe('import evidence is separate from performance', () => {
  const LOSS = {
    totals: { salesCents: 1_000_000, wageCents: 900_000, cogsCents: 0, cogsPercent: 0, cogsSource: 'purchases_only' as const, salesDays: 7 },
    venues: [],
    menu: { totals: { estimatedCogsCents: 400_000 }, rows: [] }
  };

  it('a fully imported, loss-making period reads as a severe cost, not as a data problem', () => {
    const costs = buildOverviewCosts({ ...LOSS, expectedSalesDays: 7 });
    assert.equal(costs.primeCostPercent, 130);
    assert.equal(costs.salesImport.incomplete, false);
    assert.equal(costs.lossMaking, true);
    assert.equal(costTone(costs.primeCostPercent, 60), 'danger');
    const narrative = overviewNarrative({ costs, primeTarget: 60, loading: false, periodLabel: 'this week' });
    assert.equal(narrative.tone, 'danger');
    assert.equal(narrative.headline, 'Costs exceeded sales.');
    assert.match(narrative.sub, /Prime cost \(labour \+ food\) is 130\.0%/);
    assert.doesNotMatch(narrative.sub, /check the (Square )?import/);
  });

  it('flags an incomplete import only on evidence: fewer sales days than the period has traded', () => {
    const costs = buildOverviewCosts({ ...LOSS, totals: { ...LOSS.totals, salesDays: 3 }, expectedSalesDays: 7 });
    assert.equal(costs.salesImport.incomplete, true);
    assert.deepEqual(costs.salesImport, { salesDays: 3, expectedSalesDays: 7, incomplete: true });
    const narrative = overviewNarrative({ costs, primeTarget: 60, loading: false, periodLabel: 'this week' });
    assert.equal(narrative.tone, 'neutral');
    assert.match(narrative.sub, /3 of 7 venue-days/);
    // The reading is still stated — the caveat rides alongside it.
    assert.match(narrative.sub, /130\.0%/);
  });

  it('a healthy ratio with no import evidence is simply healthy', () => {
    const costs = buildOverviewCosts({ ...WEEK, totals: { ...WEEK.totals, salesDays: 7 }, expectedSalesDays: 7 });
    assert.equal(costs.salesImport.incomplete, false);
    assert.equal(costs.lossMaking, false);
  });
});

describe('overviewNarrative', () => {
  it('describes the same figure the panel shows, with the tone the panel uses, and calls it prime cost', () => {
    const costs = buildOverviewCosts(WEEK);
    const narrative = overviewNarrative({ costs, primeTarget: 60, loading: false, periodLabel: 'this week' });
    assert.equal(narrative.tone, 'danger');
    assert.equal(narrative.headline, 'Running hot, worth a look.');
    assert.match(narrative.sub, /Prime cost \(labour \+ food\) is 93\.7% of sales/);
    assert.doesNotMatch(narrative.sub, /operating cost/i);
    assert.match(narrative.sub, /labour 59\.2% plus food 34\.5%/);
    assert.match(narrative.sub, /33\.7 pts over the 60% guide/);
    assert.equal(narrative.tone, costTone(costs.primeCostPercent, 60));
  });

  it('never calls labour alone the prime cost', () => {
    const costs = buildOverviewCosts({
      totals: { salesCents: 10_000_000, wageCents: 5_920_000, cogsCents: 0, cogsPercent: null, cogsSource: 'purchases_only' },
      venues: [],
      menu: null
    });
    const narrative = overviewNarrative({ costs, primeTarget: 60, loading: false, periodLabel: 'this week' });
    assert.equal(narrative.headline, 'Labour only so far.');
    assert.doesNotMatch(narrative.sub, /Prime cost \(labour \+ food\) is/);
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

  it('bands against the target, with a five-point warm zone, and stays red however severe', () => {
    assert.equal(costTone(60, 60), 'positive');
    assert.equal(costTone(64.9, 60), 'warning');
    assert.equal(costTone(65.1, 60), 'danger');
    assert.equal(costTone(130, 60), 'danger');
    assert.equal(costTone(null, 60), 'neutral');
  });
});
