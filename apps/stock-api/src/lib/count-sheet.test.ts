import test from 'node:test';
import assert from 'node:assert/strict';
import { STOCKTAKE_PREP_AREA } from '@alma/shared';
import { buildCountSheetSections } from './count-sheet.js';

function row(label: string, category: string | null, kind: 'STOCK_ITEM' | 'PREPPED_ITEM' = 'STOCK_ITEM') {
  return {
    lineId: null,
    itemId: kind === 'STOCK_ITEM' ? label : null,
    recipeId: kind === 'PREPPED_ITEM' ? label : null,
    label,
    sku: null,
    category,
    unit: 'each',
    purchaseUnit: null,
    conversionFactor: null,
    expectedQty: null,
    parLevel: null,
    countedQty: null,
    notes: null,
    kind,
    // The count area every item in production carries. It must not become a
    // section: that is how a 300-line sheet printed as one block called
    // "Default".
    area: 'Default'
  };
}

test('sections are categories in walking order, whatever order the lines arrive in', () => {
  const sections = buildCountSheetSections([
    row('Limes', 'Produce'),
    row('Corona', 'Beer & Cider'),
    row('Pacifico', 'Beer & Cider'),
    row('Patron Silver', 'Spirits — Tequila & Mezcal'),
    row('Beans', 'Dry / Pantry')
  ]);
  assert.deepEqual(
    sections.map((section) => [section.area, section.rows.map((r) => r.label)]),
    [
      ['Spirits — Tequila & Mezcal', ['Patron Silver']],
      ['Beer & Cider', ['Corona', 'Pacifico']],
      ['Produce', ['Limes']],
      ['Dry / Pantry', ['Beans']]
    ]
  );
});

test('prep prints last and uncategorised just before it', () => {
  const sections = buildCountSheetSections([
    row('Birria', null, 'PREPPED_ITEM'),
    row('Ice', null),
    row('Corona', 'Beer & Cider')
  ]);
  assert.deepEqual(
    sections.map((section) => section.area),
    ['Beer & Cider', 'Uncategorised', STOCKTAKE_PREP_AREA]
  );
});

test('a prepped item never lands in a shelf section even when it carries a category', () => {
  const sections = buildCountSheetSections([row('Mole', 'Dry / Pantry', 'PREPPED_ITEM')]);
  assert.equal(sections[0]?.area, STOCKTAKE_PREP_AREA);
  assert.equal('area' in (sections[0]?.rows[0] ?? {}), false);
});

test('wines carry their group and vintage so the sheet prints the wine once', () => {
  const sections = buildCountSheetSections([
    row("2023 Teusner 'Wark Family' Shiraz (Case of 12)", 'Wine — Red'),
    row('Teusner Wark Family Shiraz', 'Wine — Red'),
    row("2022 Teusner 'Wark Family' Shiraz (Case of 12)", 'Wine — Red'),
    row('Novum Pinot Noir', 'Wine — Red'),
    row('2024 Grosset Polish Hill Riesling (Case of 12)', 'Wine — White')
  ]);
  assert.deepEqual(sections.map((section) => section.area), ['Wine — White', 'Wine — Red']);
  const red = sections[1]!.rows;
  assert.deepEqual(
    red.map((r) => [r.label, r.group, r.vintage]),
    [
      ['Novum Pinot Noir', null, 'No year'],
      ['Teusner Wark Family Shiraz', 'Teusner Wark Family Shiraz', 'No year'],
      ["2022 Teusner 'Wark Family' Shiraz (Case of 12)", 'Teusner Wark Family Shiraz', '2022'],
      ["2023 Teusner 'Wark Family' Shiraz (Case of 12)", 'Teusner Wark Family Shiraz', '2023']
    ]
  );
  const white = sections[0]!.rows[0]!;
  assert.equal(white.wineName, 'Grosset Polish Hill Riesling');
  assert.equal(white.vintage, '2024');
  assert.equal(white.group, null);
});
