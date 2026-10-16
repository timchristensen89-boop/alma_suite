import test from 'node:test';
import assert from 'node:assert/strict';
import { unitMismatches, unitMismatchMessage } from './apply-unit-guard.js';

const bottle = { unit: 'bottle', countUnit: 'bottle', conversionFactor: 1, measurePerCountUnit: 750, measureUnit: 'ml' };
const bag = { unit: 'each', countUnit: 'each', conversionFactor: 1, measurePerCountUnit: 1000, measureUnit: 'g' };
const caseOf6 = { unit: 'case', countUnit: 'bottle', conversionFactor: 6, measurePerCountUnit: 750, measureUnit: 'ml' };
const byKg = { unit: 'kg', countUnit: 'kg', conversionFactor: 1, measurePerCountUnit: null, measureUnit: null };
const line = (label: string, countedQty: number | null, unit: string | null, item: typeof bottle | typeof byKg | null) => ({ label, countedQty, unit, item });

test('mL on a bottle item, g on a bag item and cases on a bottle item are refused', () => {
  const found = unitMismatches([
    line('Manly Dry Gin', 19400, 'mL', bottle),
    line('Pistachio', 970, 'g', bag),
    line('Patron', 2, 'case', caseOf6),
    line('Parrot fish', 9.2, 'g', byKg)
  ]);
  assert.deepEqual(found.map((m) => [m.label, m.convertsTo]), [
    ['Manly Dry Gin', 25.8667],
    ['Pistachio', 0.97],
    ['Patron', 12],
    ['Parrot fish', 0.0092]
  ]);
  assert.match(unitMismatchMessage(found), /4 lines are in a unit other than the item's count unit/);
  assert.match(unitMismatchMessage(found), /Manly Dry Gin: 19400 mL — counted in bottle \(about 25\.8667 bottle\)/);
});

test('numbers that carry across unchanged are allowed', () => {
  assert.deepEqual(
    unitMismatches([
      line('Same unit', 4, 'bottle', bottle),
      line('No unit', 4, null, bottle),
      line('Generic each', 4, 'each', bottle),
      line('Pack label', 4, '700ml', bottle),
      line('Other countable', 10, 'bottle', bag),
      line('Blank line', null, 'mL', bottle),
      line('Prep line', 3, 'kg', null),
      line('Metric family, same amount', 2, 'kg', byKg)
    ]),
    []
  );
});

test('a measure on an item with no measure to convert by is still refused', () => {
  const noMeasure = { unit: 'each', countUnit: 'each', conversionFactor: 1, measurePerCountUnit: null, measureUnit: null };
  const found = unitMismatches([line('Bay leaves', 170, 'g', noMeasure)]);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.convertsTo, null);
});

test('inCountUnit converts what cannot be wrong and refuses what could be', async () => {
  const { inCountUnit } = await import('./apply-unit-guard.js');
  const placeholder = { unit: 'each', countUnit: 'each', conversionFactor: 1, measurePerCountUnit: 100, measureUnit: 'g' };
  const ok = (r: ReturnType<typeof inCountUnit>) => (r.ok ? [r.countedQty, r.unit, r.converted] : r.message);
  assert.deepEqual(ok(inCountUnit(2, 'case', caseOf6)), [12, 'bottle', true]);
  assert.deepEqual(ok(inCountUnit(1500, 'g', byKg)), [1.5, 'kg', true]);
  assert.deepEqual(ok(inCountUnit(970, 'g', bag)), [0.97, 'each', true]);
  assert.deepEqual(ok(inCountUnit(4, '700ml', bottle)), [4, 'bottle', false]);
  assert.deepEqual(ok(inCountUnit(10, 'bottle', bag)), [10, 'each', false]);
  assert.deepEqual(ok(inCountUnit(null, 'g', bag)), [null, 'each', false]);
  // The first catalogue import left 100 g on 80 pack items: never trusted.
  assert.match(String(ok(inCountUnit(970, 'g', placeholder, { label: 'Pistachio' }))), /^Pistachio: 970 g can't be turned into each — the item doesn't yet say how much one each holds\. Enter it in each\.$/);
  // At apply, a conversion that rests on the measure is refused outright.
  assert.match(String(ok(inCountUnit(19400, 'mL', bottle, { allowMeasure: false }))), /has to be entered as a count/);
  assert.deepEqual(ok(inCountUnit(2, 'case', caseOf6, { allowMeasure: false })), [12, 'bottle', true]);
});
