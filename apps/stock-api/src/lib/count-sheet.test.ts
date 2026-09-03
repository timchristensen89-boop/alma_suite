import test from 'node:test';
import assert from 'node:assert/strict';
import { STOCKTAKE_PREP_AREA } from '@alma/shared';
import { buildCountSheetSections, UNASSIGNED_COUNT_AREA } from './count-sheet.js';

function row(label: string, area: string | null, kind: 'STOCK_ITEM' | 'PREPPED_ITEM' = 'STOCK_ITEM') {
  return {
    lineId: null,
    itemId: kind === 'STOCK_ITEM' ? label : null,
    recipeId: kind === 'PREPPED_ITEM' ? label : null,
    label,
    sku: null,
    category: null,
    unit: 'each',
    purchaseUnit: null,
    conversionFactor: null,
    expectedQty: null,
    parLevel: null,
    countedQty: null,
    notes: null,
    kind,
    area
  };
}

test('sections follow the walking order the lines arrive in, not the alphabet', () => {
  const sections = buildCountSheetSections([
    row('Corona', 'Bar'),
    row('Limes', 'Cool room'),
    row('Pacifico', 'Bar'),
    row('Beans', 'Dry store')
  ]);
  assert.deepEqual(
    sections.map((section) => [section.area, section.rows.map((r) => r.label)]),
    [
      ['Bar', ['Corona', 'Pacifico']],
      ['Cool room', ['Limes']],
      ['Dry store', ['Beans']]
    ]
  );
});

test('prep prints last and unassigned just before it, whatever order they came in', () => {
  const sections = buildCountSheetSections([
    row('Birria', null, 'PREPPED_ITEM'),
    row('Ice', ''),
    row('Corona', 'Bar')
  ]);
  assert.deepEqual(
    sections.map((section) => section.area),
    ['Bar', UNASSIGNED_COUNT_AREA, STOCKTAKE_PREP_AREA]
  );
});

test('a prepped item never lands in a shelf area even when it carries one', () => {
  const sections = buildCountSheetSections([row('Mole', 'Kitchen', 'PREPPED_ITEM')]);
  assert.equal(sections[0]?.area, STOCKTAKE_PREP_AREA);
  assert.equal('area' in (sections[0]?.rows[0] ?? {}), false);
});
