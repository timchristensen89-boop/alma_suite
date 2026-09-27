import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { recipeBatchCostCents, recipePortionCostCents, recipePortions, isSuspectRecipeCost } from '@alma/shared';

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

  it('no cost is null, never zero', () => {
    assert.equal(recipePortionCostCents({ estimatedCost: 0, yieldQuantity: 8, portionSize: 1 }), null);
    assert.equal(recipePortionCostCents({ estimatedCost: null, yieldQuantity: 8, portionSize: 1 }), null);
  });
});
