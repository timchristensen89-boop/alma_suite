import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { courseDishIds, stillFixed } from './set-menu-plan.js';

const course = (...recipeIds: string[]) => ({ options: recipeIds.map((recipeId) => ({ recipeId })) });
const component = (name: string, subRecipeId: string | null) => ({ name, subRecipeId });

describe('courseDishIds', () => {
  it('collects every dish the courses could serve, alternates included', () => {
    const ids = courseDishIds([course('guac'), course('snapper', 'shortrib'), course('fries')]);
    assert.deepEqual([...ids].sort(), ['fries', 'guac', 'shortrib', 'snapper']);
  });

  it('is empty for a menu with no courses, so nothing gets dropped', () => {
    assert.equal(courseDishIds([]).size, 0);
    assert.equal(courseDishIds([course()]).size, 0);
  });
});

describe('stillFixed', () => {
  it('drops a component the courses already serve', () => {
    // The whole bug: the seeder made these courses OUT of these components, so
    // without this every banquet dish landed on the bill twice.
    const components = [component('Guacamole & Tostadas', 'guac'), component('Shoestring Fries', 'fries')];
    assert.deepEqual(stillFixed(components, courseDishIds([course('guac'), course('fries')])), []);
  });

  it('keeps a component no course can serve', () => {
    const components = [component('Guacamole & Tostadas', 'guac'), component('Bread & Butter', 'bread')];
    const kept = stillFixed(components, courseDishIds([course('guac')]));
    assert.deepEqual(kept.map((line) => line.name), ['Bread & Butter']);
  });

  it('keeps a component that is only a name, having no dish to double up on', () => {
    const components = [component('Chef selection of sides', null), component('Kingfish Ceviche', 'ceviche')];
    const kept = stillFixed(components, courseDishIds([course('ceviche')]));
    assert.deepEqual(kept.map((line) => line.name), ['Chef selection of sides']);
  });

  it('leaves a menu with no courses exactly as it was', () => {
    const components = [component('Guacamole & Tostadas', 'guac'), component('Shoestring Fries', 'fries')];
    assert.deepEqual(stillFixed(components, courseDishIds([])), components);
  });

  it('drops a dish served only as an alternate on a course', () => {
    // Nobody may pick the short rib tonight, but the course can serve it, so
    // adding it as a fixed line would be a second helping.
    const components = [component('Agave Beef Short Rib', 'shortrib')];
    assert.deepEqual(stillFixed(components, courseDishIds([course('snapper', 'shortrib')])), []);
  });
});
