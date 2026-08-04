import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileLoadedQuantity,
  reconcileWithEvidence,
  bareMeasure,
  type CountUnitTarget
} from '@alma/shared';

/**
 * The unit disagreement between Loaded and Alma.
 *
 * Every figure below is from the St Alma drinks count of 1 August and the Alma
 * catalogue as it stood that day. This is the arithmetic that decides whether
 * the venue is recorded as holding 27 bottles of gin or 20,583 of them.
 */

const BOTTLE_750: CountUnitTarget = { countUnit: 'bottle', measurePerCountUnit: 750, measureUnit: 'ml' };

test('millilitres counted against a 750ml bottle become bottles', () => {
  // Loaded: "Manly Spirits Dry Gin  mL  20,583.36  $1,235.00".
  // Alma priced a bottle at $54.71, so importing 20,583.36 as bottles made it
  // $1,126,115 of gin and drove a $2.17M suggested order.
  const result = reconcileLoadedQuantity('mL', 20583.36, BOTTLE_750);
  assert.equal(result.converted, true);
  assert.equal(result.quantity, 27.44);
  assert.equal(result.warning, null);
});

test('a pack size is not a measure — 750 mL means bottles, and is left alone', () => {
  // 179 lines on that one sheet carry "750 mL". Treating them as millilitres
  // would turn 9.99 bottles into 0.01.
  const result = reconcileLoadedQuantity('750 mL', 9.99, BOTTLE_750);
  assert.equal(result.converted, false);
  assert.equal(result.quantity, 9.99);
});

test('the other three items from that sheet convert to sensible counts', () => {
  assert.equal(reconcileLoadedQuantity('mL', 22450, { ...BOTTLE_750, measurePerCountUnit: 750 }).quantity, 29.93);
  assert.equal(reconcileLoadedQuantity('mL', 10600, { ...BOTTLE_750, measurePerCountUnit: 750 }).quantity, 14.13);
  assert.equal(reconcileLoadedQuantity('mL', 23565, { ...BOTTLE_750, measurePerCountUnit: 750 }).quantity, 31.42);
});

test('a measure Alma already counts in is left exactly as counted', () => {
  // 42 food lines are counted in "Kilo" against items Alma also counts in kg.
  const result = reconcileLoadedQuantity('Kilo', 3.5, {
    countUnit: 'kg',
    measurePerCountUnit: null,
    measureUnit: null
  });
  assert.equal(result.converted, false);
  assert.equal(result.quantity, 3.5);
});

test('litres against an item counted in millilitres scale by a thousand', () => {
  const result = reconcileLoadedQuantity('Litre', 2, { countUnit: 'ml', measurePerCountUnit: null, measureUnit: null });
  assert.equal(result.quantity, 2000);
  assert.equal(result.converted, true);
});

test('kilos against a 250g punnet become punnets', () => {
  const result = reconcileLoadedQuantity('Kilo', 1.5, {
    countUnit: 'punnet',
    measurePerCountUnit: 250,
    measureUnit: 'g'
  });
  assert.equal(result.quantity, 6);
  assert.equal(result.converted, true);
});

test('volume is never converted into mass', () => {
  // A litre of something is not a kilo of it. Refuse rather than approximate.
  const result = reconcileLoadedQuantity('Litre', 2, { countUnit: 'each', measurePerCountUnit: 500, measureUnit: 'g' });
  assert.equal(result.converted, false);
  assert.equal(result.quantity, 2);
  assert.match(result.warning ?? '', /cannot be converted/);
});

test('a measure count with no pack size recorded is flagged, not imported raw', () => {
  // Importing the raw number here is exactly what caused the original mess.
  const result = reconcileLoadedQuantity('mL', 20583.36, {
    countUnit: 'bottle',
    measurePerCountUnit: null,
    measureUnit: null
  });
  assert.equal(result.converted, false);
  assert.equal(result.quantity, 20583.36);
  assert.match(result.warning ?? '', /no size recorded/);
});

test('countable units pass through untouched', () => {
  for (const unit of ['Each', 'Punnet', 'Bunch', 'Box', 'Unit', '12 Pack']) {
    const result = reconcileLoadedQuantity(unit, 65, BOTTLE_750);
    assert.equal(result.quantity, 65, unit);
    assert.equal(result.converted, false, unit);
    assert.equal(result.warning, null, unit);
  }
});

test('bareMeasure tells a measure from a pack size', () => {
  assert.equal(bareMeasure('mL')?.dimension, 'volume');
  assert.equal(bareMeasure('Kilo')?.dimension, 'mass');
  assert.equal(bareMeasure('L')?.perUnit, 1000);
  assert.equal(bareMeasure('750 mL'), null);
  assert.equal(bareMeasure('1 KG'), null);
  assert.equal(bareMeasure('Each'), null);
  assert.equal(bareMeasure(''), null);
});

test('a zero count converts to zero rather than going missing', () => {
  const result = reconcileLoadedQuantity('mL', 0, BOTTLE_750);
  assert.equal(result.quantity, 0);
});

/**
 * Weighing the conversion against what Loaded valued the line at. Both sheets
 * needed this: the drinks sheet is full of real bottle sizes and the food sheet
 * is full of placeholder ones, and nothing in the item itself tells them apart.
 */

test('a real bottle size converts, because converting is what makes the two agree', () => {
  // Loaded: 20,583.36 mL of gin, valued at $1,235.00. Alma: $54.71 a bottle.
  // As bottles that is $1,126,115 — 912x out. As 27.44 bottles it is $1,501.
  const result = reconcileWithEvidence('mL', 20583.36, { ...BOTTLE_750, unitCostCents: 5471 }, 123500);
  assert.equal(result.converted, true);
  assert.equal(result.quantity, 27.44);
  assert.equal(result.basis, 'agreed');
});

test('a placeholder pack size does not convert, because converting makes it worse', () => {
  // Alma carries "100 g per each" on Onions Brown, which was never a pack size.
  // Loaded counted 15.39 Kilo at $21.89. Converting gives 153.9 "each" and
  // $263 — twelve times out. Left alone it is $26.32, which is about right.
  const result = reconcileWithEvidence(
    'Kilo',
    15.39,
    { countUnit: 'each', measurePerCountUnit: 100, measureUnit: 'g', unitCostCents: 171 },
    2189
  );
  assert.equal(result.converted, false);
  assert.equal(result.quantity, 15.39);
  assert.equal(result.basis, 'agreed');
});

test('tomatoes are not multiplied by ten', () => {
  // The single worst line on the Avalon food sheet: converting valued 10.55 kg
  // of tomatoes at $4,405.68 against Loaded's $420.11.
  const result = reconcileWithEvidence(
    'Kilo',
    10.55,
    { countUnit: 'each', measurePerCountUnit: 100, measureUnit: 'g', unitCostCents: 4176 },
    42011
  );
  assert.equal(result.quantity, 10.55);
  assert.equal(result.converted, false);
});

test('with no cost on the item nothing is converted, and the caller is told', () => {
  // Guessing here is what put $1.13M of gin on the books. Leave the number the
  // person actually wrote and say the reading is unresolved.
  const result = reconcileWithEvidence('mL', 20583.36, { ...BOTTLE_750, unitCostCents: null }, 123500);
  assert.equal(result.converted, false);
  assert.equal(result.quantity, 20583.36);
  assert.equal(result.basis, 'no-evidence');
  assert.match(result.warning ?? '', /no cost on the item/);
});

test('a line Loaded never valued cannot be judged either', () => {
  const result = reconcileWithEvidence('mL', 20583.36, { ...BOTTLE_750, unitCostCents: 5471 }, 0);
  assert.equal(result.basis, 'no-evidence');
  assert.equal(result.quantity, 20583.36);
});

test('a line that needs no conversion is passed straight through', () => {
  const result = reconcileWithEvidence('750 mL', 9.99, { ...BOTTLE_750, unitCostCents: 5471 }, 54600);
  assert.equal(result.basis, 'unit-only');
  assert.equal(result.quantity, 9.99);
});
