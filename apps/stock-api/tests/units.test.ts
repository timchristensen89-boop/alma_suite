import assert from 'node:assert/strict';
import test from 'node:test';
import { convertQuantityToCostUnit } from '../src/services/units.js';

// avgCostCents is denominated in countUnit ?? unit. convertQuantityToCostUnit
// must express a recipe-line quantity in that cost unit.

test('same unit passes through unchanged', () => {
  const item = { unit: 'g', countUnit: 'g', conversionFactor: 1 };
  const r = convertQuantityToCostUnit(250, 'g', item);
  assert.equal(r.quantity, 250);
  assert.equal(r.via, 'same-unit');
});

test('unit aliases and plurals normalise to the cost unit', () => {
  const item = { unit: 'kg', countUnit: 'g', conversionFactor: 1000 };
  // "grams" should be recognised as g (the cost unit) → no scaling.
  const r = convertQuantityToCostUnit(250, 'grams', item);
  assert.equal(r.quantity, 250);
  assert.equal(r.via, 'same-unit');
});

test('kg line costed against a per-gram item converts up (g↔kg)', () => {
  // Cost unit is g (avgCostCents per gram); item bought by the case so the line
  // unit (kg) is not the purchase unit → resolved via metric measure, not pack.
  const item = { unit: 'case', countUnit: 'g', conversionFactor: 5000 };
  const r = convertQuantityToCostUnit(2, 'kg', item);
  assert.equal(r.quantity, 2000);
  assert.equal(r.via, 'measure');
});

test('g line costed against a per-kg item converts down (g↔kg)', () => {
  // Cost unit is kg (avgCostCents per kg, no countUnit). A 500 g line is 0.5 kg.
  const item = { unit: 'kg', countUnit: null, conversionFactor: 1 };
  const r = convertQuantityToCostUnit(500, 'g', item);
  assert.equal(r.quantity, 0.5);
  assert.equal(r.via, 'measure');
});

test('volume converts within family (ml↔L)', () => {
  // Cost unit is ml; item bought by the case so the line unit (L) is not the
  // purchase unit → resolved via metric measure.
  const item = { unit: 'case', countUnit: 'ml', conversionFactor: 24 };
  const r = convertQuantityToCostUnit(1.5, 'L', item);
  assert.equal(r.quantity, 1500);
  assert.equal(r.via, 'measure');
});

test('purchase-unit line uses the pack conversionFactor (each↔batch)', () => {
  // Item bought by the batch, counted/costed per each; 12 each per batch.
  const item = { unit: 'batch', countUnit: 'each', conversionFactor: 12 };
  const r = convertQuantityToCostUnit(2, 'batch', item);
  assert.equal(r.quantity, 24);
  assert.equal(r.via, 'pack');
});

test('incompatible units are left unconverted and flagged', () => {
  // g cannot be converted to each → return raw quantity, via 'unknown'.
  const item = { unit: 'each', countUnit: 'each', conversionFactor: 1 };
  const r = convertQuantityToCostUnit(50, 'g', item);
  assert.equal(r.quantity, 50);
  assert.equal(r.via, 'unknown');
});

test('missing line unit assumes the cost unit', () => {
  const item = { unit: 'kg', countUnit: 'g', conversionFactor: 1000 };
  const r = convertQuantityToCostUnit(30, null, item);
  assert.equal(r.quantity, 30);
  assert.equal(r.via, 'same-unit');
});
