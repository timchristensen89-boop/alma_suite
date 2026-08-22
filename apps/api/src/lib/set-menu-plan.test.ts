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

describe('removing a course', () => {
  it('hands its dishes BACK to the fixed list, which is why they still print', () => {
    // Reported from the floor: "when I remove courses from the set menus it
    // still prints on the POS."
    //
    // This is why. Courses and components are two records of the same dish.
    // While the course exists it suppresses the component, so the table is
    // ASKED. Delete the course and nothing suppresses the component any more,
    // so the dish comes back as a fixed inclusion — and a fixed inclusion is
    // added to every bill automatically and fires to the kitchen without
    // anybody choosing it.
    //
    // Removing a course therefore does not remove the dish. It changes the
    // dish from "ask the table" to "everyone gets one", which is the opposite
    // of what removing it looks like it should do.
    const components = [component('Entree', 'entree'), component('Bread & Butter', 'bread')];

    const withCourse = stillFixed(components, courseDishIds([course('entree')]));
    assert.deepEqual(withCourse.map((line) => line.name), ['Bread & Butter']);

    const courseRemoved = stillFixed(components, courseDishIds([]));
    assert.deepEqual(courseRemoved.map((line) => line.name), ['Entree', 'Bread & Butter']);
  });

  it('leaves nothing behind when the component was deleted too', () => {
    // The workaround, and the shape of any real fix: the component has to go
    // as well, because the component is what prints.
    const components = [component('Bread & Butter', 'bread')];
    assert.deepEqual(stillFixed(components, courseDishIds([])).map((line) => line.name), ['Bread & Butter']);
  });
});

describe('costingOnly', () => {
  const priced = (name: string, subRecipeId: string | null, costingOnly = false) => ({
    name,
    subRecipeId,
    costingOnly
  });

  it('keeps the drinks allowance off the bill and off the docket', () => {
    // The whole point: a banquet is priced to include what the table drinks,
    // but "Average drinks" is not a thing the kitchen or the bar can make.
    const components = [priced('Bread & Butter', 'bread'), priced('Average drinks per head', 'drinks', true)];
    assert.deepEqual(stillFixed(components, courseDishIds([])).map((line) => line.name), ['Bread & Butter']);
  });

  it('suppresses it even when no course exists at all', () => {
    // A menu with no courses is the case where every component is fixed. The
    // allowance still must not print.
    const components = [priced('Average drinks per head', 'drinks', true)];
    assert.deepEqual(stillFixed(components, courseDishIds([])), []);
  });

  it('suppresses it even if a course happens to serve the same dish', () => {
    // Belt and braces: costingOnly wins outright rather than depending on
    // whether some course also mentions the dish.
    const components = [priced('Average drinks per head', 'drinks', true)];
    assert.deepEqual(stillFixed(components, courseDishIds([course('drinks')])), []);
  });

  it('leaves everything else exactly as it was', () => {
    // The flag defaults false and older callers do not set it at all, so an
    // undefined costingOnly must behave like the old two-state rule.
    const components = [{ name: 'Bread & Butter', subRecipeId: 'bread' }, { name: 'Guacamole', subRecipeId: 'guac' }];
    assert.deepEqual(
      stillFixed(components, courseDishIds([course('guac')])).map((line) => line.name),
      ['Bread & Butter']
    );
  });
});
