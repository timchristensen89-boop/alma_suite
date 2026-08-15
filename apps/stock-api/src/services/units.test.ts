import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import {
  convertBetweenUnits,
  convertQuantityToCostUnit,
  normaliseUnitLabel,
  setActiveUnitAliases
} from '@alma/shared';

// The labels here are the ones Loaded actually prints — the point of the suite
// is that a Loaded count reads correctly against Alma's items without anyone
// retyping units.

describe('normaliseUnitLabel', () => {
  afterEach(() => setActiveUnitAliases(null));

  it('canonicalises spellings, case, plurals and dots', () => {
    assert.equal(normaliseUnitLabel('KILO'), 'kg');
    assert.equal(normaliseUnitLabel('Kilos.'), 'kg');
    assert.equal(normaliseUnitLabel('KG'), 'kg');
    assert.equal(normaliseUnitLabel('Grams'), 'g');
    assert.equal(normaliseUnitLabel('Ltr'), 'l');
    assert.equal(normaliseUnitLabel('EACH'), 'each');
    assert.equal(normaliseUnitLabel('Unit'), 'each');
    assert.equal(normaliseUnitLabel('units'), 'each');
    assert.equal(normaliseUnitLabel('Btls'), 'bottle');
    assert.equal(normaliseUnitLabel('Boxes'), 'box');
  });

  it('canonicalises pack-size labels to base units', () => {
    assert.equal(normaliseUnitLabel('700ml'), '700ml');
    assert.equal(normaliseUnitLabel('700 mL'), '700ml');
    assert.equal(normaliseUnitLabel('0.7 L'), '700ml');
    assert.equal(normaliseUnitLabel('1 KG'), '1000g');
    assert.equal(normaliseUnitLabel('1000 g'), '1000g');
  });

  it('a loaded alias table replaces the defaults entirely', () => {
    setActiveUnitAliases({ sack: 'bag' });
    assert.equal(normaliseUnitLabel('sack'), 'bag');
    // 'kilo' was a default; with a live table loaded it no longer applies,
    // so deleting a seeded alias in the UI really turns it off.
    assert.equal(normaliseUnitLabel('kilo'), 'kilo');
  });
});

describe('convertQuantityToCostUnit', () => {
  afterEach(() => setActiveUnitAliases(null));

  const bottle = { unit: 'bottle', countUnit: 'bottle', conversionFactor: 1 };

  it('KILO counts read against a kg item', () => {
    const item = { unit: 'kg', countUnit: 'KG', conversionFactor: 1 };
    assert.deepEqual(convertQuantityToCostUnit(12.5, 'KILO', item), {
      quantity: 12.5,
      via: 'same-unit'
    });
  });

  it('"700ml" against a bottle item counts bottles', () => {
    assert.deepEqual(convertQuantityToCostUnit(6, '700ml', bottle), {
      quantity: 6,
      via: 'pack-label'
    });
    assert.deepEqual(convertQuantityToCostUnit(6, '750 mL', bottle), {
      quantity: 6,
      via: 'pack-label'
    });
  });

  it('a plain countable reads against a pack-label count unit', () => {
    const item = { unit: '750ml', countUnit: '750ml', conversionFactor: 1 };
    assert.deepEqual(convertQuantityToCostUnit(3, 'bottle', item), {
      quantity: 3,
      via: 'pack-label'
    });
    // And two spellings of the same pack size are simply the same unit.
    assert.deepEqual(convertQuantityToCostUnit(3, '750 mL', item), {
      quantity: 3,
      via: 'same-unit'
    });
  });

  it('pack labels convert into a bare-measure count unit by arithmetic', () => {
    const item = { unit: 'l', countUnit: 'L', conversionFactor: 1 };
    const converted = convertQuantityToCostUnit(2, '700ml', item);
    assert.equal(converted.via, 'measure');
    assert.ok(Math.abs(converted.quantity - 1.4) < 1e-9);
  });

  it('pack labels across dimensions stay unknown', () => {
    const item = { unit: 'kg', countUnit: 'kg', conversionFactor: 1 };
    assert.equal(convertQuantityToCostUnit(2, '700ml', item).via, 'unknown');
  });

  it('a digit-bearing purchase unit still converts by the pack factor', () => {
    const item = { unit: '12 Pack', countUnit: 'bottle', conversionFactor: 12 };
    assert.deepEqual(convertQuantityToCostUnit(2, '12 pack', item), {
      quantity: 24,
      via: 'pack'
    });
  });

  it('a bare measure against a countable is NOT converted on the label alone', () => {
    // 2,113 real lines are labelled "ml" against bottles and hold ordinary
    // bottle counts — the label is wrong metadata, the numbers are right.
    // Converting these on the label is what corrupted the stock values.
    assert.equal(convertQuantityToCostUnit(20, 'ml', bottle).via, 'unknown');
  });

  it('a bare measure bridges via measurePerCountUnit when the item declares one', () => {
    const punnet = {
      unit: 'punnet',
      countUnit: 'punnet',
      conversionFactor: 1,
      measurePerCountUnit: 250,
      measureUnit: 'g'
    };
    assert.deepEqual(convertQuantityToCostUnit(500, 'Grams', punnet), {
      quantity: 2,
      via: 'measure-pack'
    });
  });

  it('honours aliases added at runtime', () => {
    setActiveUnitAliases({ nip: 'bottle' });
    assert.deepEqual(convertQuantityToCostUnit(4, 'Nips', bottle), {
      quantity: 4,
      via: 'same-unit'
    });
  });
});

describe('convertBetweenUnits', () => {
  it('converts within a metric family and refuses across', () => {
    assert.equal(convertBetweenUnits(1500, 'mL', 'L'), 1.5);
    assert.equal(convertBetweenUnits(2, 'KILO', 'g'), 2000);
    assert.equal(convertBetweenUnits(2, 'each', 'L'), null);
  });
});
