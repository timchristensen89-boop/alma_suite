import assert from 'node:assert/strict';
import test from 'node:test';
import { orphanedComponents } from './setMenuOrphans.js';

const course = (...recipeIds: string[]) => ({ options: recipeIds.map((recipeId) => ({ recipeId })) });
const component = (subRecipeId: string | null, title: string) => ({
  subRecipeId,
  ingredientName: title,
  subRecipe: subRecipeId ? { title } : null
});

test('a dish the removed course was the only one asking about is stranded', () => {
  // The reported bug, in one case: remove the entree course and the entree
  // becomes something every table is given without being asked.
  const orphans = orphanedComponents(
    [course('entree'), course('main')],
    0,
    [component('entree', 'Chicken Tinga Empanada'), component('main', 'Snapper')]
  );
  assert.deepEqual(orphans, [{ subRecipeId: 'entree', name: 'Chicken Tinga Empanada' }]);
});

test('a dish another course still serves is NOT stranded', () => {
  // Snapper is an option in both courses. Removing the first still leaves the
  // table being asked, so warning about it would be noise — and worse, would
  // invite deleting a component that is still in use.
  const orphans = orphanedComponents(
    [course('entree', 'snapper'), course('snapper', 'shortrib')],
    0,
    [component('snapper', 'Snapper'), component('entree', 'Empanada')]
  );
  assert.deepEqual(orphans.map((o) => o.subRecipeId), ['entree']);
});

test('a dish with no component behind it strands nothing', () => {
  // Courses can offer dishes the menu was never costed as containing. There is
  // no component to come back as a fixed line, so there is nothing to warn on.
  assert.deepEqual(orphanedComponents([course('entree')], 0, [component('bread', 'Bread & Butter')]), []);
});

test('the bread and butter nobody was ever asked about is left alone', () => {
  // A component with no course is ALREADY a fixed inclusion and always was.
  // Removing an unrelated course does not change it, so it must not appear.
  const orphans = orphanedComponents(
    [course('entree')],
    0,
    [component('entree', 'Empanada'), component('bread', 'Bread & Butter')]
  );
  assert.deepEqual(orphans.map((o) => o.name), ['Empanada']);
});

test('a component that is only a name is skipped', () => {
  // "Chef's choice of sides" has no dish behind it, so nothing can double up.
  assert.deepEqual(orphanedComponents([course('entree')], 0, [component(null, "Chef's selection")]), []);
});

test('a dish already staged for removal is not offered twice', () => {
  // Two courses, both serving the same dish, removed one after the other. The
  // second removal must not re-offer what the first already staged.
  const components = [component('entree', 'Empanada')];
  const orphans = orphanedComponents([course('entree')], 0, components, ['entree']);
  assert.deepEqual(orphans, []);
});

test('the same dish listed as two components is reported once', () => {
  // Duplicated component rows are real in this data — see the register's
  // duplicate dishes. Naming the dish twice in a warning reads like two dishes.
  const orphans = orphanedComponents(
    [course('entree')],
    0,
    [component('entree', 'Empanada'), component('entree', 'Empanada')]
  );
  assert.equal(orphans.length, 1);
});

test('an index that is not a course strands nothing', () => {
  assert.deepEqual(orphanedComponents([course('entree')], 5, [component('entree', 'Empanada')]), []);
  assert.deepEqual(orphanedComponents([], 0, [component('entree', 'Empanada')]), []);
});

test('the name falls back when the dish has no title', () => {
  const orphans = orphanedComponents(
    [course('entree')],
    0,
    [{ subRecipeId: 'entree', ingredientName: 'House entree', subRecipe: null }]
  );
  assert.deepEqual(orphans, [{ subRecipeId: 'entree', name: 'House entree' }]);
});
