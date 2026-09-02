import test from 'node:test';
import assert from 'node:assert/strict';
import { coreStockItemName, findDuplicateGroups } from '@alma/shared';

// Names taken from the live catalogue export the merge script was written
// against, so the rule is tested on what the venues actually typed.
test('pack notes, sizes and plurals fold into one core name', () => {
  assert.equal(coreStockItemName('Corona 355ml (case of 24)'), 'corona');
  assert.equal(coreStockItemName('Corona 355ML'), 'corona');
  assert.equal(coreStockItemName('Limes'), 'lime');
  assert.equal(coreStockItemName('Beef Short Ribs'), 'beef short rib');
  assert.equal(coreStockItemName('BEANS BLACK DRY 1KG'), 'bean black dry');
  assert.equal(coreStockItemName('Chipotle in Adobo 2.8kg tin'), 'chipotle in adobo');
});

test('a double s is not a plural', () => {
  assert.equal(coreStockItemName('Molasses'), 'molasses');
  assert.equal(coreStockItemName('Glass'), 'glass');
});

test('groups the same product under different spellings and leaves distinct products alone', () => {
  const groups = findDuplicateGroups([
    { id: '1', name: 'Corona 355ml (case of 24)', unit: 'case' },
    { id: '2', name: 'Corona 355ml', unit: 'case' },
    { id: '3', name: 'Pacifico 355ml (case of 24)', unit: 'case' },
    { id: '4', name: 'Limes', unit: 'kg' },
    { id: '5', name: 'Lime', unit: 'kg' }
  ]);
  assert.deepEqual(
    groups.map((group) => group.items.map((item) => item.id)),
    [['2', '1'], ['5', '4']]
  );
  assert.equal(groups.every((group) => !group.sizeConflict && !group.unitConflict), true);
});

test('different pack sizes are reported but flagged, never silently merged', () => {
  const [group] = findDuplicateGroups([
    { id: 'a', name: 'Black Beans Dry 1kg', unit: 'bag' },
    { id: 'b', name: 'Black Beans Dry 12.5kg', unit: 'bag' }
  ]);
  assert.equal(group?.sizeConflict, true);
});

test('different purchase units are flagged', () => {
  const [group] = findDuplicateGroups([
    { id: 'a', name: 'Coke 330ml (case of 24)', unit: 'case' },
    { id: 'b', name: 'Coke 330ml', unit: 'can' }
  ]);
  assert.equal(group?.unitConflict, true);
});

test('wine and spirits match on the exact name only — vintages and bottlings are distinct', () => {
  const groups = findDuplicateGroups([
    { id: 'r23', name: 'Clare Valley Riesling 2023', unit: 'bottle', categoryName: 'Wine' },
    { id: 'r22', name: 'Clare Valley Riesling 2022', unit: 'bottle', categoryName: 'Wine' },
    { id: 'g700', name: 'Tanqueray Gin 700ml', unit: 'bottle', categoryName: 'Spirits' },
    { id: 'g1l', name: 'Tanqueray Gin 1L', unit: 'bottle', categoryName: 'Spirits' },
    { id: 'dj1', name: 'Don Julio Blanco 750ml', unit: 'bottle', categoryName: 'Spirits' },
    { id: 'dj2', name: 'Don Julio Blanco 750ML', unit: 'bottle', categoryName: 'Spirits' }
  ]);
  assert.deepEqual(groups.map((group) => group.items.map((item) => item.id)), [['dj1', 'dj2']]);
  assert.equal(groups[0]?.basis, 'exact');
});

test('archived items are never offered as duplicates', () => {
  const groups = findDuplicateGroups([
    { id: '1', name: 'Limes', unit: 'kg', status: 'ACTIVE' },
    { id: '2', name: 'Lime', unit: 'kg', status: 'ARCHIVED' }
  ]);
  assert.equal(groups.length, 0);
});

test('clean groups sort before flagged ones', () => {
  const groups = findDuplicateGroups([
    { id: 'a', name: 'Black Beans Dry 1kg', unit: 'bag' },
    { id: 'b', name: 'Black Beans Dry 12.5kg', unit: 'bag' },
    { id: 'c', name: 'Limes', unit: 'kg' },
    { id: 'd', name: 'Lime', unit: 'kg' }
  ]);
  assert.deepEqual(groups.map((group) => group.sizeConflict), [false, true]);
});
