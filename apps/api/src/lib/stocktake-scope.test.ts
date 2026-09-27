import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessStocktakeValuation, classifyStockHeading, scopeForTemplate, scopeFromHeadings, scopeFromTemplateName } from '@alma/shared';

describe('scope from evidence, never from the dollar value', () => {
  it('classifies Alma\'s real category names', () => {
    for (const h of ['Spirits — Tequila & Mezcal', 'Wine — Red', 'Beer & Cider', 'Liqueurs & Aperitifs', 'Non-Alcoholic & Mixers']) {
      assert.equal(classifyStockHeading(h), 'beverage', h);
    }
    for (const h of ['Dairy & Eggs', 'Dry / Pantry', 'Meat & Poultry', 'Produce', 'Seafood', 'Bakery', 'Desserts & Sweets', 'Frozen', 'Herbs & Spices', 'Oils & Condiments']) {
      assert.equal(classifyStockHeading(h), 'food', h);
    }
    assert.equal(classifyStockHeading('Other'), null);
    assert.equal(classifyStockHeading('Review'), null);
    assert.equal(classifyStockHeading(''), null);
  });

  it('the Kitchen template is FOOD and the Bar & FOH template is BEVERAGE, from their categories', () => {
    const kitchen = scopeForTemplate({ name: 'St Alma — Kitchen', categoryNames: ['Dairy', 'Dry Goods', 'Meat', 'Produce', 'Seafood', 'Bakery', 'Dairy & Eggs', 'Desserts & Sweets', 'Dry / Pantry', 'Frozen', 'Herbs & Spices', 'Meat & Poultry', 'Oils & Condiments'] });
    assert.equal(kitchen.scope, 'FOOD');
    assert.match(kitchen.evidence, /categories: all 13 headings are food/);
    const bar = scopeForTemplate({ name: 'Alma Avalon — Bar & FOH', categoryNames: ['Spirits', 'Wine', 'Beer & Cider', 'Liqueurs & Aperitifs', 'Non-Alcoholic & Mixers', 'Spirits — Other', 'Spirits — Tequila & Mezcal', 'Wine — Red', 'Wine — Rosé', 'Wine — Sparkling', 'Wine — White'] });
    assert.equal(bar.scope, 'BEVERAGE');
  });

  it('falls back to the template name when categories are unavailable', () => {
    assert.equal(scopeFromTemplateName('St Alma — Kitchen').scope, 'FOOD');
    assert.equal(scopeFromTemplateName('Alma Avalon — Bar & FOH').scope, 'BEVERAGE');
    assert.equal(scopeForTemplate({ name: 'St Alma — Kitchen' }).scope, 'FOOD');
  });

  it('a "Full count" template is UNKNOWN, not COMBINED: a name never supports COMBINED', () => {
    assert.equal(scopeFromTemplateName('Full count').scope, 'UNKNOWN');
    const full = scopeForTemplate({ name: 'Full count', categoryNames: ['Spirits', 'Produce'] });
    assert.equal(full.scope, 'UNKNOWN');
    assert.match(full.evidence, /does not say what was counted/);
  });

  it('Loaded sheet headings: entirely beverage → BEVERAGE, entirely food → FOOD, one unclassified heading → UNKNOWN', () => {
    assert.equal(scopeFromHeadings(['Spirits', 'Wine', 'Beer', 'Bottled'], 'drinks.json').scope, 'BEVERAGE');
    assert.equal(scopeFromHeadings(['Dairy', 'Dry Goods', 'Meat', 'Produce'], 'avalonfood.json').scope, 'FOOD');
    const mixed = scopeFromHeadings(['Spirits', 'Produce'], 'sheet');
    assert.equal(mixed.scope, 'UNKNOWN');
    assert.match(mixed.evidence, /mix food and beverage/);
    const odd = scopeFromHeadings(['Spirits', 'Sundries'], 'sheet');
    assert.equal(odd.scope, 'UNKNOWN');
    assert.match(odd.evidence, /unclassified heading "Sundries"/);
    assert.equal(scopeFromHeadings([], 'sheet').scope, 'UNKNOWN');
  });
});

describe('valuation completeness: every line counted above zero must carry a value', () => {
  it('a fully valued count is sufficient, and legitimate zeros do not count against it', () => {
    const v = assessStocktakeValuation([
      { itemId: 'a', countedQty: 2, stockValueCents: 1_000 },
      { itemId: 'b', countedQty: 0, stockValueCents: 0 },
      { itemId: 'c', countedQty: 0, stockValueCents: null },
      { recipeId: 'prep', countedQty: 1.5, stockValueCents: 900 }
    ]);
    assert.equal(v.sufficient, true);
    assert.deepEqual([v.counted, v.zero, v.linkedValued, v.unlinkedValued, v.unvalued], [4, 2, 2, 0, 0]);
    assert.equal(v.valueCents, 1_900);
    assert.equal(v.valuedShare, 1);
  });

  it('an unlinked line with an explicit (Loaded) value is valued; an unlinked line without one is not', () => {
    const v = assessStocktakeValuation([
      { itemId: null, countedQty: 3, stockValueCents: 4_500 },
      { itemId: null, countedQty: 3, stockValueCents: null }
    ]);
    assert.equal(v.unlinkedValued, 1);
    assert.equal(v.unvalued, 1);
    assert.equal(v.sufficient, false);
    assert.match(v.reason ?? '', /1 of 2 counted lines carries no value/);
  });

  it('a linked line whose item has no cost is unvalued — a missing valuation, not a zero', () => {
    const v = assessStocktakeValuation([{ itemId: 'a', countedQty: 12, stockValueCents: null }]);
    assert.equal(v.sufficient, false);
    assert.equal(v.valuedShare, 0);
  });

  it('a large missing share on a plausible total cannot qualify: 151 of 311 lines unvalued', () => {
    const lines = [
      ...Array.from({ length: 160 }, (_, i) => ({ itemId: `i${i}`, countedQty: 1, stockValueCents: 13_522 })),
      ...Array.from({ length: 151 }, () => ({ itemId: null, countedQty: 1, stockValueCents: null }))
    ];
    const v = assessStocktakeValuation(lines);
    assert.equal(v.valueCents, 160 * 13_522); // $21,635.20, the figure that looked complete
    assert.equal(v.sufficient, false);
    assert.equal(v.valuedShare, 0.514);
  });

  it('nothing counted, or no lines at all, is not a count', () => {
    assert.equal(assessStocktakeValuation([]).sufficient, false);
    assert.equal(assessStocktakeValuation([{ itemId: 'a', countedQty: null, stockValueCents: null }]).sufficient, false);
  });
});
