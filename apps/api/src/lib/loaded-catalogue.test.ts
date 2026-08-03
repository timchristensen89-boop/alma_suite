import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAgainstCatalogue, nameSimilarity, newItemShapeFromLoadedUnit } from '@alma/shared';

/**
 * Deciding what to do with a Loaded name Alma has never seen.
 *
 * Every pair below is a real one from the 124 unmatched lines on the St Alma
 * drinks sheet. Getting this wrong in either direction is expensive and quiet:
 * create a duplicate and the counts stop adding up, or file a count against the
 * wrong product and the variance report blames the wrong shelf.
 */

const CATALOGUE = [
  'Shut The Gate For Freedom Gewurztraminer',
  '2023 Louis Jadot Pouilly-Fuisse (Case of 12)',
  'Giffard Mandarin Liqueur',
  'STRANGELOVE VERY MANDARIN - (CASE OF 24)',
  'Bruxo No. 4',
  'ArteNom 1579',
  'First Press Black Cold Drip Coffee Mixer',
  'Ron Santiago de Cuba Carta Blanca'
];

test('a misspelling is recognised as the same wine', () => {
  // Loaded drops the r: "Gewuztraminer".
  const result = classifyAgainstCatalogue('Shut The Gate For Freedom Gewuztraminer', CATALOGUE);
  assert.equal(result.verdict, 'same');
  assert.equal(result.verdict === 'same' && result.match, 'Shut The Gate For Freedom Gewurztraminer');
});

test('vintage and case size do not stop a match', () => {
  const result = classifyAgainstCatalogue('Louis Jadot Puilly-Fuisse', CATALOGUE);
  assert.equal(result.verdict, 'same');
});

test('a shouted, cased supplier name still matches the floor name', () => {
  const result = classifyAgainstCatalogue('Strangelove Very Madarin', CATALOGUE);
  assert.equal(result.verdict, 'same');
});

test('two expressions of the same mezcal are NOT merged', () => {
  // Bruxo No. 2 and No. 4 score 0.90 — higher than pairs that genuinely match.
  // The number is the product, so they must stay apart.
  const result = classifyAgainstCatalogue('Bruxo No. 2', CATALOGUE);
  assert.notEqual(result.verdict, 'same');
});

test('a close pair with a word missing is left for a person', () => {
  // "First Press Cold Drip" vs "First Press Black Cold Drip" — same product, but
  // at 0.85 it sits below where guessing is safe, so it is asked about.
  const result = classifyAgainstCatalogue('First Press Cold Drip Coffee Mixer', CATALOGUE);
  assert.equal(result.verdict, 'unsure');
  assert.equal(result.verdict === 'unsure' && result.match, 'First Press Black Cold Drip Coffee Mixer');
});

test('a genuinely new wine is reported as new', () => {
  const result = classifyAgainstCatalogue('Stephane Brocard Gevrey-Chambertin', CATALOGUE);
  assert.equal(result.verdict, 'new');
});

test('an empty catalogue makes everything new', () => {
  assert.equal(classifyAgainstCatalogue('Anything At All', []).verdict, 'new');
});

test('similarity is symmetric and bounded', () => {
  assert.equal(nameSimilarity('abc', 'abc'), 1);
  assert.equal(nameSimilarity('', ''), 1);
  assert.equal(nameSimilarity('abc', 'xyz'), 0);
  assert.equal(nameSimilarity('kitten', 'sitting'), nameSimilarity('sitting', 'kitten'));
});

/** How a new item is shaped from the unit Loaded counted it in. */

test('a 750ml drink becomes a bottle, matching every wine already in Alma', () => {
  assert.deepEqual(newItemShapeFromLoadedUnit('750 mL', true), {
    unit: 'bottle',
    countUnit: 'bottle',
    conversionFactor: 1,
    measurePerCountUnit: 750,
    measureUnit: 'ml'
  });
});

test('a 700ml spirit is a bottle too', () => {
  assert.equal(newItemShapeFromLoadedUnit('700 mL', true).measurePerCountUnit, 700);
  assert.equal(newItemShapeFromLoadedUnit('700 mL', true).countUnit, 'bottle');
});

test('a 20L keg is not a bottle', () => {
  const shape = newItemShapeFromLoadedUnit('20 L', true);
  assert.equal(shape.countUnit, 'each');
  assert.equal(shape.measurePerCountUnit, 20000);
});

test('food counted by weight is counted in that weight, not an invented pack', () => {
  // The blanket "100 g per each" on existing food items is exactly what this
  // avoids: an honest kg beats a made-up pack size.
  assert.deepEqual(newItemShapeFromLoadedUnit('Kilo', false), {
    unit: 'kg',
    countUnit: 'kg',
    conversionFactor: 1,
    measurePerCountUnit: null,
    measureUnit: null
  });
  assert.equal(newItemShapeFromLoadedUnit('Litre', false).countUnit, 'L');
  assert.equal(newItemShapeFromLoadedUnit('mL', false).countUnit, 'ml');
});

test('a 5 KG box of avocados carries its weight', () => {
  const shape = newItemShapeFromLoadedUnit('5 KG', false);
  assert.equal(shape.countUnit, 'each');
  assert.equal(shape.measurePerCountUnit, 5000);
  assert.equal(shape.measureUnit, 'g');
});

test('countable things keep their own word', () => {
  assert.equal(newItemShapeFromLoadedUnit('Punnet', false).countUnit, 'punnet');
  assert.equal(newItemShapeFromLoadedUnit('Bunch', false).countUnit, 'bunch');
  assert.equal(newItemShapeFromLoadedUnit('Each', false).countUnit, 'each');
  assert.equal(newItemShapeFromLoadedUnit('12 Pack', false).countUnit, '12 pack');
});
