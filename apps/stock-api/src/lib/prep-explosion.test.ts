import test from 'node:test';
import assert from 'node:assert/strict';
import {
  batchesForCount,
  explodePrepCount,
  prepCountReadiness,
  summarisePrepLines,
  type PrepExplosion,
  type PrepRecipeSpec,
  type PrepStockItem,
  type PrepSummaryLine
} from './prep-explosion.js';

/** tsconfig has noUncheckedIndexedAccess, so index then narrow. */
function at<T>(list: T[], index: number): T {
  const value = list[index];
  assert.ok(value !== undefined, `expected an entry at index ${index}`);
  return value;
}

function item(over: Partial<PrepStockItem> & { id: string; name: string }): PrepStockItem {
  return {
    unit: 'kg',
    countUnit: null,
    conversionFactor: 1,
    avgCostCents: 100,
    ...over
  };
}

function recipe(over: Partial<PrepRecipeSpec> & { id: string; title: string }): PrepRecipeSpec {
  return { yieldQuantity: 1, yieldUnit: 'kg', lines: [], ...over };
}

function maps(items: PrepStockItem[], recipes: PrepRecipeSpec[]) {
  return {
    itemsById: new Map(items.map((i) => [i.id, i])),
    recipesById: new Map(recipes.map((r) => [r.id, r]))
  };
}

/* ---------------------------------------------------------------- batches */

test('a count in the yield unit is a straight division', () => {
  const mayo = recipe({ id: 'r1', title: 'Chipotle Mayo', yieldQuantity: 11.7, yieldUnit: 'kg' });
  const { batches, warning } = batchesForCount(11.707, 'kg', mayo);
  assert.equal(warning, null);
  assert.ok(batches !== null);
  assert.ok(Math.abs(batches - 1.0006) < 0.001, `expected ~1 batch, got ${batches}`);
});

test('grams against a kilogram yield convert rather than mis-scale', () => {
  // 950 g of chorizo filling against a 5 kg batch is 0.19 batches, not 190.
  const filling = recipe({ id: 'r1', title: 'Chorizo Taco Filling', yieldQuantity: 5, yieldUnit: 'kg' });
  const { batches } = batchesForCount(950, 'g', filling);
  assert.equal(batches, 0.19);
});

test('a recipe with no yield refuses to guess and says what to fix', () => {
  const noYield = recipe({ id: 'r1', title: 'Sikil Pak', yieldQuantity: null });
  const { batches, warning } = batchesForCount(4.126, 'kg', noYield);
  assert.equal(batches, null);
  assert.match(String(warning), /no batch yield/);
  assert.match(String(warning), /Sikil Pak/);
});

test('kilograms against a portion yield is unanswerable, not a guess', () => {
  // The ribs the chef counted: "30 kg, equivalent to 75 portions". If the
  // recipe yields portions and the count is in kg, 30 is neither 30 portions
  // nor 30 batches. Refusing is the only honest answer.
  const ribs = recipe({ id: 'r1', title: 'Short Ribs', yieldQuantity: 75, yieldUnit: 'portion' });
  const { batches, warning } = batchesForCount(30, 'kg', ribs);
  assert.equal(batches, null);
  assert.match(String(warning), /counted in kg/);
  assert.match(String(warning), /makes portion/);
});

test('a counted zero is zero batches, not a refusal', () => {
  const empty = recipe({ id: 'r1', title: 'Tinga', yieldQuantity: 10, yieldUnit: 'kg' });
  assert.deepEqual(batchesForCount(0, 'kg', empty), { batches: 0, warning: null });
});

/* -------------------------------------------------------------- explosion */

test('a counted tub explodes into the raw items it holds', () => {
  const mayonnaise = item({ id: 'i1', name: 'Mayonnaise', unit: 'kg', avgCostCents: 800 });
  const chipotle = item({ id: 'i2', name: 'Chipotle in adobo', unit: 'kg', avgCostCents: 2200 });
  const mayo = recipe({
    id: 'r1',
    title: 'Chipotle Mayo',
    yieldQuantity: 11.7,
    yieldUnit: 'kg',
    lines: [
      { ingredientName: 'Mayonnaise', quantity: 10, unit: 'kg', itemId: 'i1', subRecipeId: null },
      { ingredientName: 'Chipotle in adobo', quantity: 1.7, unit: 'kg', itemId: 'i2', subRecipeId: null }
    ]
  });
  const { itemsById, recipesById } = maps([mayonnaise, chipotle], [mayo]);

  const result = explodePrepCount({ countedQty: 11.7, countedUnit: 'kg', recipe: mayo, recipesById, itemsById });

  assert.deepEqual(result.warnings, []);
  assert.equal(result.batches, 1);
  assert.equal(result.components.length, 2);
  assert.equal(at(result.components, 1).itemName, 'Mayonnaise');
  assert.equal(at(result.components, 1).quantity, 10);
  // 10 kg × $8 + 1.7 kg × $22 = $80 + $37.40.
  assert.equal(result.valueCents, 8000 + 3740);
});

test('half a batch takes half of everything', () => {
  const beans = item({ id: 'i1', name: 'Black beans', unit: 'kg' });
  const puree = recipe({
    id: 'r1',
    title: 'Bean Puree',
    yieldQuantity: 18,
    yieldUnit: 'kg',
    lines: [{ ingredientName: 'Black beans', quantity: 9, unit: 'kg', itemId: 'i1', subRecipeId: null }]
  });
  const { itemsById, recipesById } = maps([beans], [puree]);
  const result = explodePrepCount({ countedQty: 8.884, countedUnit: 'kg', recipe: puree, recipesById, itemsById });
  // 8.884 / 18 batches × 9 kg = 4.442 kg.
  assert.equal(at(result.components, 0).quantity, 4.442);
});

test('a sub-recipe is followed through to its own raw items', () => {
  // Beef Birria contains Beef Birria Adobo, which contains guajillo chilli.
  const beef = item({ id: 'i1', name: 'Beef chuck', unit: 'kg', avgCostCents: 1800 });
  const guajillo = item({ id: 'i2', name: 'Guajillo chilli', unit: 'kg', avgCostCents: 4000 });
  const adobo = recipe({
    id: 'r2',
    title: 'Beef Birria Adobo',
    yieldQuantity: 2,
    yieldUnit: 'kg',
    lines: [{ ingredientName: 'Guajillo chilli', quantity: 0.5, unit: 'kg', itemId: 'i2', subRecipeId: null }]
  });
  const birria = recipe({
    id: 'r1',
    title: 'Beef Birria',
    yieldQuantity: 12,
    yieldUnit: 'kg',
    lines: [
      { ingredientName: 'Beef chuck', quantity: 10, unit: 'kg', itemId: 'i1', subRecipeId: null },
      { ingredientName: 'Beef Birria Adobo', quantity: 2, unit: 'kg', itemId: null, subRecipeId: 'r2' }
    ]
  });
  const { itemsById, recipesById } = maps([beef, guajillo], [birria, adobo]);

  // The chef counted 6 kg of birria — half a batch.
  const result = explodePrepCount({ countedQty: 6, countedUnit: 'kg', recipe: birria, recipesById, itemsById });

  assert.deepEqual(result.warnings, []);
  assert.equal(result.components.length, 2);
  const beefRow = result.components.find((c) => c.itemId === 'i1');
  const chilliRow = result.components.find((c) => c.itemId === 'i2');
  assert.equal(beefRow?.quantity, 5); // half of 10 kg
  // Half a birria batch → 1 kg of adobo → half an adobo batch → 0.25 kg chilli.
  assert.equal(chilliRow?.quantity, 0.25);
  assert.equal(chilliRow?.viaRecipeTitle, 'Beef Birria Adobo');
});

test('an item reached down two branches is summed onto one line', () => {
  const salt = item({ id: 'i1', name: 'Salt', unit: 'kg' });
  const brine = recipe({
    id: 'r2',
    title: 'Brine',
    yieldQuantity: 1,
    yieldUnit: 'kg',
    lines: [{ ingredientName: 'Salt', quantity: 0.1, unit: 'kg', itemId: 'i1', subRecipeId: null }]
  });
  const parent = recipe({
    id: 'r1',
    title: 'Pork Cochinita',
    yieldQuantity: 1,
    yieldUnit: 'kg',
    lines: [
      { ingredientName: 'Salt', quantity: 0.2, unit: 'kg', itemId: 'i1', subRecipeId: null },
      { ingredientName: 'Brine', quantity: 1, unit: 'kg', itemId: null, subRecipeId: 'r2' }
    ]
  });
  const { itemsById, recipesById } = maps([salt], [parent, brine]);
  const result = explodePrepCount({ countedQty: 1, countedUnit: 'kg', recipe: parent, recipesById, itemsById });
  assert.equal(result.components.length, 1);
  // 0.2 + 0.1 in floats is 0.30000000000000004; rounding is what keeps two
  // identical counts from differing in the last digit.
  assert.equal(at(result.components, 0).quantity, 0.3);
  assert.equal(at(result.components, 0).viaRecipeTitle, 'Pork Cochinita, Brine');
});

test('wastage is not added back: the trim is in the bin, not the tub', () => {
  // Costing multiplies by 1 + waste because you must buy the trim. A count
  // must not, because you cannot count it. 10 kg in the recipe stays 10 kg.
  const onion = item({ id: 'i1', name: 'Onion', unit: 'kg' });
  const mix = recipe({
    id: 'r1',
    title: 'Eggplant Mix',
    yieldQuantity: 10,
    yieldUnit: 'kg',
    lines: [{ ingredientName: 'Onion', quantity: 10, unit: 'kg', itemId: 'i1', subRecipeId: null }]
  });
  const { itemsById, recipesById } = maps([onion], [mix]);
  const result = explodePrepCount({ countedQty: 10, countedUnit: 'kg', recipe: mix, recipesById, itemsById });
  assert.equal(at(result.components, 0).quantity, 10);
});

test('a costing-only line is never booked back into stock', () => {
  const drinks = item({ id: 'i1', name: 'Average drinks allowance', unit: 'each' });
  const spec = recipe({
    id: 'r1',
    title: 'Banquet',
    lines: [{ ingredientName: 'Drinks', quantity: 1, unit: 'each', itemId: 'i1', subRecipeId: null, costingOnly: true }]
  });
  const { itemsById, recipesById } = maps([drinks], [spec]);
  const result = explodePrepCount({ countedQty: 1, countedUnit: 'kg', recipe: spec, recipesById, itemsById });
  assert.deepEqual(result.components, []);
});

test('an unconvertible ingredient unit is dropped and named, never mis-scaled', () => {
  // Costing 500 g against an item counted in bottles, with no measure bridge,
  // would book 500 bottles. It books nothing and says so.
  const wine = item({ id: 'i1', name: 'Cooking wine', unit: 'bottle', countUnit: 'bottle' });
  const sauce = recipe({
    id: 'r1',
    title: 'Veracruzana Sauce',
    yieldQuantity: 5,
    yieldUnit: 'kg',
    lines: [{ ingredientName: 'Cooking wine', quantity: 500, unit: 'g', itemId: 'i1', subRecipeId: null }]
  });
  const { itemsById, recipesById } = maps([wine], [sauce]);
  const result = explodePrepCount({ countedQty: 5, countedUnit: 'kg', recipe: sauce, recipesById, itemsById });
  assert.deepEqual(result.components, []);
  assert.equal(result.warnings.length, 1);
  assert.match(at(result.warnings, 0), /Cooking wine/);
  assert.match(at(result.warnings, 0), /do not convert/);
});

test('a free-text ingredient is named rather than silently dropped', () => {
  const spec = recipe({
    id: 'r1',
    title: 'Habanero Salsa',
    lines: [{ ingredientName: 'Habanero', quantity: 1, unit: 'kg', itemId: null, subRecipeId: null }]
  });
  const { itemsById, recipesById } = maps([], [spec]);
  const result = explodePrepCount({ countedQty: 1, countedUnit: 'kg', recipe: spec, recipesById, itemsById });
  assert.deepEqual(result.components, []);
  assert.match(at(result.warnings, 0), /not linked to a stock item/);
});

test('one uncosted ingredient makes the whole tub unvalued, not part-valued', () => {
  const costed = item({ id: 'i1', name: 'Pumpkin seed', unit: 'kg', avgCostCents: 1500 });
  const uncosted = item({ id: 'i2', name: 'Achiote', unit: 'kg', avgCostCents: null });
  const spec = recipe({
    id: 'r1',
    title: 'Sikil Pak',
    yieldQuantity: 4,
    yieldUnit: 'kg',
    lines: [
      { ingredientName: 'Pumpkin seed', quantity: 3, unit: 'kg', itemId: 'i1', subRecipeId: null },
      { ingredientName: 'Achiote', quantity: 1, unit: 'kg', itemId: 'i2', subRecipeId: null }
    ]
  });
  const { itemsById, recipesById } = maps([costed, uncosted], [spec]);
  const result = explodePrepCount({ countedQty: 4.126, countedUnit: 'kg', recipe: spec, recipesById, itemsById });
  // Both quantities still book — an uncosted item is still stock.
  assert.equal(result.components.length, 2);
  assert.equal(result.valueCents, null);
  assert.match(result.warnings.join(' '), /cannot be valued: no average cost for Achiote/);
});

test('a recipe that refers back to itself stops instead of looping', () => {
  const a = recipe({
    id: 'r1',
    title: 'A',
    lines: [{ ingredientName: 'B', quantity: 1, unit: 'kg', itemId: null, subRecipeId: 'r2' }]
  });
  const b = recipe({
    id: 'r2',
    title: 'B',
    lines: [{ ingredientName: 'A', quantity: 1, unit: 'kg', itemId: null, subRecipeId: 'r1' }]
  });
  const { itemsById, recipesById } = maps([], [a, b]);
  const result = explodePrepCount({ countedQty: 1, countedUnit: 'kg', recipe: a, recipesById, itemsById });
  assert.match(result.warnings.join(' '), /already in the chain/);
});

test('a count of nothing books nothing', () => {
  const beans = item({ id: 'i1', name: 'Black beans', unit: 'kg' });
  const spec = recipe({
    id: 'r1',
    title: 'Bean Puree',
    yieldQuantity: 10,
    yieldUnit: 'kg',
    lines: [{ ingredientName: 'Black beans', quantity: 5, unit: 'kg', itemId: 'i1', subRecipeId: null }]
  });
  const { itemsById, recipesById } = maps([beans], [spec]);
  const result = explodePrepCount({ countedQty: 0, countedUnit: 'kg', recipe: spec, recipesById, itemsById });
  assert.equal(result.batches, 0);
  assert.deepEqual(result.components, []);
  assert.equal(result.valueCents, 0);
});

/* -------------------------------------------------------------- readiness */

test('readiness passes a recipe that is genuinely countable', () => {
  const beans = item({ id: 'i1', name: 'Black beans', unit: 'kg' });
  const spec = recipe({
    id: 'r1',
    title: 'Bean Puree',
    yieldQuantity: 10,
    yieldUnit: 'kg',
    lines: [{ ingredientName: 'Black beans', quantity: 5, unit: 'kg', itemId: 'i1', subRecipeId: null }]
  });
  const { itemsById, recipesById } = maps([beans], [spec]);
  const ready = prepCountReadiness(spec, recipesById, itemsById);
  assert.equal(ready.countable, true);
  assert.deepEqual(ready.problems, []);
});

test('readiness names every reason a recipe cannot be counted', () => {
  const spec = recipe({ id: 'r1', title: 'Morita Salsa', yieldQuantity: null, yieldUnit: '', lines: [] });
  const { itemsById, recipesById } = maps([], [spec]);
  const ready = prepCountReadiness(spec, recipesById, itemsById);
  assert.equal(ready.countable, false);
  assert.match(ready.problems.join(' '), /No batch yield/);
  assert.match(ready.problems.join(' '), /No yield unit/);
  assert.match(ready.problems.join(' '), /No ingredient lines/);
});

test('a missing cost does not make a recipe uncountable', () => {
  // Quantities are the point; the value is a bonus. An uncosted ingredient
  // still books the right kilograms back onto the shelf.
  const uncosted = item({ id: 'i1', name: 'Achiote', unit: 'kg', avgCostCents: null });
  const spec = recipe({
    id: 'r1',
    title: 'Adobo',
    yieldQuantity: 2,
    yieldUnit: 'kg',
    lines: [{ ingredientName: 'Achiote', quantity: 2, unit: 'kg', itemId: 'i1', subRecipeId: null }]
  });
  const { itemsById, recipesById } = maps([uncosted], [spec]);
  assert.equal(prepCountReadiness(spec, recipesById, itemsById).countable, true);
});

test('readiness catches a unit mismatch the field checks cannot see', () => {
  const wine = item({ id: 'i1', name: 'Cooking wine', unit: 'bottle', countUnit: 'bottle' });
  const spec = recipe({
    id: 'r1',
    title: 'Veracruzana Sauce',
    yieldQuantity: 5,
    yieldUnit: 'kg',
    lines: [{ ingredientName: 'Cooking wine', quantity: 500, unit: 'g', itemId: 'i1', subRecipeId: null }]
  });
  const { itemsById, recipesById } = maps([wine], [spec]);
  const ready = prepCountReadiness(spec, recipesById, itemsById);
  assert.equal(ready.countable, false);
  assert.match(ready.problems.join(' '), /do not convert/);
});

/* ------------------------------------------------------------------ merge */

function sheetLine(over: Partial<PrepSummaryLine> & { id: string; label: string }): PrepSummaryLine {
  return { itemId: null, recipeId: null, countedQty: null, unit: null, ...over };
}

// A tub of chipotle mayo holding 10 kg of mayonnaise and 1.7 kg of chipotle.
function mayoExplosion(): PrepExplosion {
  return {
    recipeId: 'r1',
    recipeTitle: 'Chipotle Mayo',
    batches: 1,
    components: [
      { itemId: 'i1', itemName: 'Mayonnaise', quantity: 10, unit: 'kg', valueCents: 8000, viaRecipeTitle: 'Chipotle Mayo' },
      { itemId: 'i2', itemName: 'Chipotle in adobo', quantity: 1.7, unit: 'kg', valueCents: 3740, viaRecipeTitle: 'Chipotle Mayo' }
    ],
    valueCents: 11740,
    warnings: []
  };
}

test('prep is added to what was counted loose, not substituted for it', () => {
  // Two kilos of mayonnaise on the shelf and ten more inside the mayo. Twelve
  // is the answer; either number alone is a lie about the stock.
  const lines = [
    sheetLine({ id: 'l1', label: 'Mayonnaise', itemId: 'i1', countedQty: 2, unit: 'kg' }),
    sheetLine({ id: 'l2', label: 'Chipotle in adobo', itemId: 'i2', countedQty: 0.5, unit: 'kg' }),
    sheetLine({ id: 'l3', label: 'Chipotle Mayo', recipeId: 'r1', countedQty: 11.7, unit: 'kg' })
  ];
  const summary = summarisePrepLines(lines, [null, null, mayoExplosion()]);

  assert.equal(summary.notOnSheet.length, 0);
  assert.equal(summary.contributions.length, 2);
  const mayonnaise = summary.contributions.find((row) => row.itemId === 'i1');
  assert.equal(mayonnaise?.countedOnSheet, 2);
  assert.equal(mayonnaise?.quantity, 10);
  assert.equal(mayonnaise?.totalToBook, 12);
  assert.deepEqual(mayonnaise?.fromPrep, ['Chipotle Mayo']);
  assert.equal(summary.totalValueCents, 11740);
});

test('an ingredient the sheet never counted is left alone and named', () => {
  // The dangerous case. Booking 10 kg as mayonnaise's on-hand here would say
  // the only mayonnaise in the building is what is inside the tub, and record
  // every loose jar as shrinkage — worse than the bug being fixed.
  const lines = [
    sheetLine({ id: 'l2', label: 'Chipotle in adobo', itemId: 'i2', countedQty: 0.5, unit: 'kg' }),
    sheetLine({ id: 'l3', label: 'Chipotle Mayo', recipeId: 'r1', countedQty: 11.7, unit: 'kg' })
  ];
  const summary = summarisePrepLines(lines, [null, mayoExplosion()]);

  assert.equal(summary.contributions.length, 1);
  assert.equal(at(summary.contributions, 0).itemId, 'i2');
  assert.equal(summary.notOnSheet.length, 1);
  assert.equal(at(summary.notOnSheet, 0).itemId, 'i1');
  // Nothing to book: the caller has no total to write.
  assert.equal(at(summary.notOnSheet, 0).totalToBook, null);
  assert.match(summary.warnings.join(' '), /Mayonnaise is held inside Chipotle Mayo/);
  assert.match(summary.warnings.join(' '), /left untouched/);
});

test('an item on the sheet but not counted is treated as not counted', () => {
  // countedQty null is "nobody has looked at this shelf yet". We do not know
  // the loose amount, so the same rule applies as if it were absent.
  const lines = [
    sheetLine({ id: 'l1', label: 'Mayonnaise', itemId: 'i1', countedQty: null, unit: 'kg' }),
    sheetLine({ id: 'l2', label: 'Chipotle in adobo', itemId: 'i2', countedQty: 0.5, unit: 'kg' }),
    sheetLine({ id: 'l3', label: 'Chipotle Mayo', recipeId: 'r1', countedQty: 11.7, unit: 'kg' })
  ];
  const summary = summarisePrepLines(lines, [null, null, mayoExplosion()]);
  assert.deepEqual(summary.notOnSheet.map((row) => row.itemId), ['i1']);
});

test('a counted zero is a count, and takes its prep share', () => {
  // "There are no jars left" is a real observation, unlike a blank. The tub's
  // ten kilos are the only mayonnaise in the building, and that is correct.
  const lines = [
    sheetLine({ id: 'l1', label: 'Mayonnaise', itemId: 'i1', countedQty: 0, unit: 'kg' }),
    sheetLine({ id: 'l2', label: 'Chipotle in adobo', itemId: 'i2', countedQty: 0, unit: 'kg' }),
    sheetLine({ id: 'l3', label: 'Chipotle Mayo', recipeId: 'r1', countedQty: 11.7, unit: 'kg' })
  ];
  const summary = summarisePrepLines(lines, [null, null, mayoExplosion()]);
  assert.equal(summary.notOnSheet.length, 0);
  assert.equal(summary.contributions.find((row) => row.itemId === 'i1')?.totalToBook, 10);
});

test('one item counted in two places sums before the prep is added', () => {
  const lines = [
    sheetLine({ id: 'l1', label: 'Mayonnaise (dry store)', itemId: 'i1', countedQty: 2, unit: 'kg' }),
    sheetLine({ id: 'l2', label: 'Mayonnaise (line fridge)', itemId: 'i1', countedQty: 3, unit: 'kg' }),
    sheetLine({ id: 'l3', label: 'Chipotle in adobo', itemId: 'i2', countedQty: 0, unit: 'kg' }),
    sheetLine({ id: 'l4', label: 'Chipotle Mayo', recipeId: 'r1', countedQty: 11.7, unit: 'kg' })
  ];
  const summary = summarisePrepLines(lines, [null, null, null, mayoExplosion()]);
  const mayonnaise = summary.contributions.find((row) => row.itemId === 'i1');
  assert.equal(mayonnaise?.countedOnSheet, 5);
  assert.equal(mayonnaise?.totalToBook, 15);
});

test('two prepped items sharing an ingredient contribute once, from both', () => {
  const birria: PrepExplosion = {
    recipeId: 'r2',
    recipeTitle: 'Beef Birria',
    batches: 0.5,
    components: [
      { itemId: 'i2', itemName: 'Chipotle in adobo', quantity: 0.3, unit: 'kg', valueCents: 660, viaRecipeTitle: 'Beef Birria' }
    ],
    valueCents: 660,
    warnings: []
  };
  const lines = [
    sheetLine({ id: 'l1', label: 'Mayonnaise', itemId: 'i1', countedQty: 0, unit: 'kg' }),
    sheetLine({ id: 'l2', label: 'Chipotle in adobo', itemId: 'i2', countedQty: 1, unit: 'kg' }),
    sheetLine({ id: 'l3', label: 'Chipotle Mayo', recipeId: 'r1', countedQty: 11.7, unit: 'kg' }),
    sheetLine({ id: 'l4', label: 'Beef Birria', recipeId: 'r2', countedQty: 6, unit: 'kg' })
  ];
  const summary = summarisePrepLines(lines, [null, null, mayoExplosion(), birria]);
  const chipotle = summary.contributions.find((row) => row.itemId === 'i2');
  assert.equal(chipotle?.quantity, 2);
  assert.deepEqual(chipotle?.fromPrep, ['Chipotle Mayo', 'Beef Birria']);
  assert.equal(chipotle?.totalToBook, 3);
  assert.equal(summary.totalValueCents, 11740 + 660);
});

test('an uncounted prep line is listed but contributes nothing', () => {
  const lines = [
    sheetLine({ id: 'l1', label: 'Mayonnaise', itemId: 'i1', countedQty: 2, unit: 'kg' }),
    sheetLine({ id: 'l3', label: 'Chipotle Mayo', recipeId: 'r1', countedQty: null, unit: 'kg' })
  ];
  const summary = summarisePrepLines(lines, [null, null]);
  assert.equal(summary.lines.length, 1);
  assert.equal(at(summary.lines, 0).countedQty, null);
  assert.equal(at(summary.lines, 0).componentCount, 0);
  assert.deepEqual(summary.contributions, []);
});

test('a prep line that explodes into nothing is visible, not silent', () => {
  // The failure this feature would otherwise hide: counted, saved, approved,
  // and it booked nothing at all.
  const noYield: PrepExplosion = {
    recipeId: 'r9',
    recipeTitle: 'Sikil Pak',
    batches: null,
    components: [],
    valueCents: null,
    warnings: ['Sikil Pak has no batch yield, so a count of it cannot be turned into ingredients.']
  };
  const lines = [sheetLine({ id: 'l1', label: 'Sikil Pak', recipeId: 'r9', countedQty: 4.126, unit: 'kg' })];
  const summary = summarisePrepLines(lines, [noYield]);
  assert.equal(at(summary.lines, 0).componentCount, 0);
  assert.equal(at(summary.lines, 0).batches, null);
  assert.equal(summary.totalValueCents, null);
  assert.match(summary.warnings.join(' '), /no batch yield/);
});

test('a count with no prepped items summarises to nothing at all', () => {
  const lines = [sheetLine({ id: 'l1', label: 'Mayonnaise', itemId: 'i1', countedQty: 2, unit: 'kg' })];
  const summary = summarisePrepLines(lines, [null]);
  assert.deepEqual(summary.lines, []);
  assert.deepEqual(summary.contributions, []);
  assert.deepEqual(summary.notOnSheet, []);
  assert.equal(summary.totalValueCents, 0);
});
