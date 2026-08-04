import test from 'node:test';
import assert from 'node:assert/strict';
import {
  implausibleCountLines,
  countedValueExcludingImplausible,
  IMPLAUSIBLE_COUNT_SHARE,
  type CountedLine
} from '@alma/shared';

/**
 * The real production shape: a few unit mistakes carrying most of the value,
 * surrounded by thousands of ordinary lines. Costs and quantities below are
 * the actual ones found in the venue's stocktake history.
 */
const GIN: CountedLine = {
  itemId: 'gin',
  itemName: 'Manly Spirits Dry Gin',
  venue: 'St Alma',
  countedQty: 21725.32,
  unitCostCents: 5471,
  countUnit: 'bottle',
  measurePerCountUnit: 750,
  measureUnit: 'ml'
};
const TRIPLE_SEC: CountedLine = {
  itemId: 'triple-sec',
  itemName: 'Manly Spirits Triple Sec',
  venue: 'St Alma',
  countedQty: 15900,
  unitCostCents: 3875,
  countUnit: 'bottle',
  measurePerCountUnit: 700,
  measureUnit: 'ml'
};
const KEG: CountedLine = {
  itemId: 'keg',
  itemName: 'Wedge Cerveza Keg',
  venue: 'St Alma',
  countedQty: 216.9,
  unitCostCents: 27000,
  countUnit: 'keg',
  measurePerCountUnit: 10000,
  measureUnit: 'ml'
};

/** Ordinary lines — the 99th percentile of real counted lines is $2,310. */
function ordinary(n: number): CountedLine[] {
  return Array.from({ length: n }, (_, i) => ({
    itemId: `item-${i}`,
    itemName: `Ordinary item ${i}`,
    venue: 'St Alma',
    countedQty: 12,
    unitCostCents: 660, // $79.20 a line — the real median
    countUnit: 'each',
    measurePerCountUnit: null,
    measureUnit: null
  }));
}

test('a count made in millilitres is caught', () => {
  const flagged = implausibleCountLines([GIN, ...ordinary(400)]);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0]!.itemName, 'Manly Spirits Dry Gin');
  assert.ok(flagged[0]!.lineValueCents > 100_000_00);
});

test('it says what the count probably meant', () => {
  const [gin] = implausibleCountLines([GIN, ...ordinary(400)]);
  // 21,725.32 ml over 750ml a bottle is about 29 bottles — a believable bar.
  assert.deepEqual(gin!.ifMeasuredInstead, { quantity: 28.97, unit: 'bottle' });
  assert.ok(gin!.message.includes('ml'));
  assert.ok(gin!.message.includes('28.97'));
});

test('ordinary counting is never flagged', () => {
  const flagged = implausibleCountLines(ordinary(500));
  assert.deepEqual(flagged, []);
});

test('the biggest genuine line in production stays clear of the rule', () => {
  // $2,310 is the 99th percentile of 4,456 real counted lines.
  const realistic: CountedLine = {
    itemId: 'big-but-real',
    itemName: 'Expensive but genuine',
    venue: 'St Alma',
    countedQty: 10,
    unitCostCents: 23_100,
    countUnit: 'each',
    measurePerCountUnit: null,
    measureUnit: null
  };
  const flagged = implausibleCountLines([realistic, ...ordinary(4000)]);
  assert.deepEqual(flagged, []);
});

test('several mistakes in one count are all caught, worst first', () => {
  const flagged = implausibleCountLines([KEG, GIN, TRIPLE_SEC, ...ordinary(4000)]);
  assert.deepEqual(
    flagged.map((line) => line.itemName),
    ['Manly Spirits Dry Gin', 'Manly Spirits Triple Sec', 'Wedge Cerveza Keg']
  );
});

test('a small venue with one modest line is left alone', () => {
  // Without a floor this line is 100% of the count and would be flagged.
  const only: CountedLine = {
    itemId: 'vinegar',
    itemName: 'House vinegar',
    venue: 'Alma Avalon',
    countedQty: 3,
    unitCostCents: 400,
    countUnit: 'bottle',
    measurePerCountUnit: 500,
    measureUnit: 'ml'
  };
  assert.deepEqual(implausibleCountLines([only]), []);
});

test('an item with no cost cannot be judged and is not guessed at', () => {
  const uncosted: CountedLine = {
    itemId: 'uncosted',
    itemName: 'No cost on record',
    venue: 'St Alma',
    countedQty: 999999,
    unitCostCents: null,
    countUnit: 'each',
    measurePerCountUnit: null,
    measureUnit: null
  };
  assert.deepEqual(implausibleCountLines([uncosted, ...ordinary(200)]), []);
});

test('an item with no measure is still flagged, just without the guess', () => {
  const noMeasure: CountedLine = {
    ...GIN,
    itemId: 'no-measure',
    measurePerCountUnit: null,
    measureUnit: null
  };
  const [flagged] = implausibleCountLines([noMeasure, ...ordinary(400)]);
  assert.equal(flagged!.ifMeasuredInstead, null);
  assert.ok(flagged!.message.includes('a different unit'));
});

test('an empty or valueless count returns nothing rather than dividing by zero', () => {
  assert.deepEqual(implausibleCountLines([]), []);
  assert.deepEqual(
    implausibleCountLines([{ ...GIN, unitCostCents: 0 }]),
    []
  );
});

test('the trusted total separates real stock from unit mistakes', () => {
  const lines = [GIN, TRIPLE_SEC, KEG, ...ordinary(4000)];
  const result = countedValueExcludingImplausible(lines);
  assert.equal(result.excludedLines, 3);
  assert.ok(result.excludedCents > result.trustedCents, 'the mistakes outweigh the real stock, as in production');
  assert.equal(result.totalCents, result.trustedCents + result.excludedCents);
  // The real venue: $4.86M counted, of which $3.71M is not real.
  assert.ok(result.trustedCents > 0);
});

test('the share threshold is the one measured against real data', () => {
  assert.equal(IMPLAUSIBLE_COUNT_SHARE, 0.02);
});

test('a negative or zero count never trips the rule', () => {
  const odd: CountedLine = { ...GIN, countedQty: -5000 };
  assert.deepEqual(implausibleCountLines([odd, ...ordinary(100)]), []);
});
