import assert from 'node:assert/strict';
import test from 'node:test';
import { dishTokens, matchDish, parsePrintedMarks, scoreDish } from './dish-dietary.js';

// ── Reading the printed key ─────────────────────────────────────────────────

test('the printed marks become tag ids', () => {
  assert.deepEqual(parsePrintedMarks('VG·GFA·DF').tags, ['vgn', 'gfo', 'df']);
  assert.deepEqual(parsePrintedMarks('V·GF·N').tags, ['veg', 'gf', 'nuts']);
});

test('australian and imported are provenance, not dietary', () => {
  const read = parsePrintedMarks('GF·DF·A');
  assert.deepEqual(read.tags, ['gf', 'df']);
  assert.deepEqual(read.provenance, ['A']);
  assert.deepEqual(parsePrintedMarks('GFA·DF·I').provenance, ['I']);
});

test('GFA is gluten free ON ASK, not gluten free', () => {
  // The difference between "we can do that" and "that is safe as it stands".
  assert.deepEqual(parsePrintedMarks('GFA').tags, ['gfo']);
  assert.deepEqual(parsePrintedMarks('GF').tags, ['gf']);
});

test('a mark nobody recognises is reported, never dropped silently', () => {
  const read = parsePrintedMarks('GF·XY');
  assert.deepEqual(read.tags, ['gf']);
  assert.deepEqual(read.unknown, ['XY']);
});

// ── Reading a dish name ─────────────────────────────────────────────────────

test('kitchen asides in brackets are not part of the name', () => {
  assert.deepEqual(dishTokens('Chicken Tinga Empanada (1pc)'), ['chicken', 'tinga', 'empanada']);
  assert.deepEqual(dishTokens('Green Leaf Salad (Mixed Greens)'), ['green', 'leaf', 'salad']);
});

test('plurals and piece counts do not stop a match', () => {
  assert.equal(scoreDish('Chicken tinga empanadas', 'Chicken Tinga Empanada (1pc)'), 1);
  assert.equal(scoreDish('Barramundi taco', 'Barramundi Taco Grilled'), 1);
});

test('accents fold, so the printed spelling matches the register', () => {
  assert.deepEqual(dishTokens('Pipián mole'), dishTokens('Pipian mole'));
});

// ── Refusing to guess ───────────────────────────────────────────────────────

test('a dish the register does not have comes back unmatched', () => {
  const result = matchDish('Nashi pear', ['Shoestring Fries', 'Guacamole & Tostadas']);
  assert.equal(result.kind, 'unmatched');
});

test('two plausible dishes come back ambiguous rather than one being picked', () => {
  const result = matchDish('Grilled snapper', [
    'Grilled Snapper (Al Pastor base)',
    'Grilled Snapper Chipotle'
  ]);
  assert.equal(result.kind, 'ambiguous');
  if (result.kind === 'ambiguous') assert.equal(result.candidates.length, 2);
});

test('a clear winner is taken', () => {
  const result = matchDish('Broccolini', ['Broccolini, almond mole', 'Shoestring Fries']);
  assert.equal(result.kind, 'matched');
  if (result.kind === 'matched') assert.equal(result.registerTitle, 'Broccolini, almond mole');
});

// ── The venue trap ──────────────────────────────────────────────────────────

test('the two guacamoles are indistinguishable by name, which is why venue scoping is not optional', () => {
  // St Alma's guacamole is salsa macha and carries a nut mark; Avalon's is
  // wakame and does not. Both are just "Guacamole" in print. If the caller
  // ever pooled the venues, one of these tables would get the other's
  // allergens — so this test exists to state that the matcher CANNOT tell
  // them apart and must never be asked to.
  assert.equal(scoreDish('Guacamole', 'Guacamole & Tostadas'), 1);
  const stAlma = parsePrintedMarks('VG·GFA·DF·N').tags;
  const avalon = parsePrintedMarks('VG·GFA·DF').tags;
  assert.ok(stAlma.includes('nuts'));
  assert.ok(!avalon.includes('nuts'));
});

test('scoring asks whether the register carries everything the menu named', () => {
  // Asymmetric on purpose: the register title is usually the longer one.
  assert.equal(scoreDish('Broccolini', 'Broccolini, almond mole'), 1);
  assert.ok(scoreDish('Broccolini almond mole', 'Broccolini') < 1);
});
