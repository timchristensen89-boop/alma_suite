import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { recipeBatchCostCents, recipePortionCost, recipePortionCostCents, recipePortions, isSuspectRecipeCost, SERVE_SIZE_REQUIRED } from '@alma/shared';

// A batch of guacamole: 2 kg of ingredients costing $50.00, served in 50 g
// portions — 40 serves at $1.25 each.
const GUACAMOLE = { estimatedCost: 50, yieldQuantity: 2000, portionSize: 50 };

describe('one sold serve costs the batch ÷ its portions', () => {
  it('divides the batch cost by yield ÷ portion size', () => {
    assert.equal(recipePortions(GUACAMOLE), 40);
    assert.equal(recipePortionCostCents(GUACAMOLE), 125);
    assert.equal(recipeBatchCostCents(GUACAMOLE), 5000);
  });

  it('the symptom: the batch cost is not what ten sold serves cost', () => {
    // Ten guacamoles sold at $9.00 each: $12.50 of cost, not $500.
    const sold = 10;
    const theoretical = (recipePortionCostCents(GUACAMOLE) ?? 0) * sold;
    assert.equal(theoretical, 1250);
    assert.notEqual((recipeBatchCostCents(GUACAMOLE) ?? 0) * sold, theoretical);
    // And the row no longer trips the suspect guard that was hiding it.
    assert.equal(isSuspectRecipeCost(recipePortionCostCents(GUACAMOLE) ?? 0, 9000, sold), false);
    assert.equal(isSuspectRecipeCost(recipeBatchCostCents(GUACAMOLE) ?? 0, 9000, sold), true);
  });

  it('a single-serve dish (no yield) costs its batch', () => {
    assert.equal(recipePortionCostCents({ estimatedCost: 8.5, yieldQuantity: null, portionSize: null }), 850);
    assert.equal(recipePortionCostCents({ estimatedCost: 8.5, yieldQuantity: 1, portionSize: null }), 850);
  });

  it('yield alone is a serve count', () => {
    assert.equal(recipePortionCostCents({ estimatedCost: 20, yieldQuantity: 8, portionSize: null }), 250);
  });

  it('a gram yield with no serve size has NO per-serve cost: "Serve size required", not batch ÷ grams', () => {
    // 2 kg of guacamole costing $50 with no serve size. The editor's old
    // rule divided by 2000 and called a serve 2.5 cents.
    const recipe = { estimatedCost: 50, yieldQuantity: 2000, yieldUnit: 'g', portionSize: null };
    assert.deepEqual(recipePortionCost(recipe), { cents: null, reason: 'serve_size_required', label: SERVE_SIZE_REQUIRED });
    assert.equal(recipePortionCostCents(recipe), null);
    assert.equal(recipePortionCost({ ...recipe, yieldUnit: 'kg', yieldQuantity: 2 }).reason, 'serve_size_required');
    assert.equal(recipePortionCost({ ...recipe, yieldUnit: 'mL', yieldQuantity: 5000 }).reason, 'serve_size_required');
    // With the serve size stated, the cost exists.
    assert.equal(recipePortionCost({ ...recipe, portionSize: 50 }).cents, 125);
    // A yield counted in serves needs no serve size.
    assert.equal(recipePortionCost({ ...recipe, yieldUnit: 'serves', yieldQuantity: 40 }).cents, 125);
    assert.equal(recipePortionCost({ ...recipe, yieldUnit: null, yieldQuantity: 40 }).cents, 125);
  });

  it('no cost is null, never zero', () => {
    assert.equal(recipePortionCostCents({ estimatedCost: 0, yieldQuantity: 8, portionSize: 1 }), null);
    assert.equal(recipePortionCostCents({ estimatedCost: null, yieldQuantity: 8, portionSize: 1 }), null);
  });
});
