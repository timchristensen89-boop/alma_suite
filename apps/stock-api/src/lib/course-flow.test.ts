import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NOW, TIER_MAIN, TIER_NOW, TIER_STARTER, TIER_TACO, courseTier, planCourseFlow, isDrink } from './course-flow.js';

const dish = (title: string, category?: string | null, kind?: string | null) => ({ title, category: category ?? null, kind: kind ?? null });

/** The three live menus, in the order the seeder lifts them off the costing. */
const BOTTOMLESS = [
  dish('Guacamole & Tostadas'),
  dish('Kingfish Ceviche'),
  dish('Barramundi Taco Grilled'),
  dish('Beef Birria Taco'),
  dish('Classic/Jalapeño Margarita', 'Cocktails'),
  dish('Prosecco 125mL', 'Sparkling Wine'),
  dish('Corona', 'Beer')
];

const FEASTING = [
  dish('Guacamole & Tostadas'),
  dish('Kingfish Ceviche'),
  dish('Barramundi Taco Grilled'),
  dish('Beef Birria Taco'),
  dish('Grilled Snapper (Al Pastor base)'),
  dish('Agave Beef Short Rib'),
  dish('Broccolini, almond mole'),
  dish('Green Leaf Salad (Mixed Greens)'),
  dish('Shoestring Fries')
];

const GRAZING = [
  dish('Guacamole & Tostadas'),
  dish('Chicken Tinga Empanada (1pc)'),
  dish('Kingfish Ceviche'),
  dish('Barramundi Taco Grilled'),
  dish('Beef Birria Taco'),
  dish('Shoestring Fries'),
  dish('Green Leaf Salad (Mixed Greens)'),
  dish('Broccolini, almond mole')
];

describe('courseTier', () => {
  it('fires every drink now, whichever way the register files it', () => {
    assert.equal(courseTier(dish('Classic/Jalapeño Margarita', 'Cocktails')), TIER_NOW);
    assert.equal(courseTier(dish('Prosecco 125mL', 'Sparkling Wine')), TIER_NOW);
    assert.equal(courseTier(dish('Corona', 'Beer')), TIER_NOW);
    assert.equal(courseTier(dish('Espresso Martini', null, 'Bar Dish')), TIER_NOW);
  });

  it('fires the dips and chips now', () => {
    assert.equal(courseTier(dish('Guacamole & Tostadas')), TIER_NOW);
    assert.equal(courseTier(dish('Chips & Salsa')), TIER_NOW);
  });

  it('does not mistake food for a drink because of an ingredient', () => {
    // The whole reason kind and category are read and the title is not.
    assert.equal(courseTier(dish('Tequila Lime Prawns')), TIER_MAIN);
    assert.equal(courseTier(dish('Beer-battered Barramundi')), TIER_MAIN);
    assert.equal(courseTier(dish('Coffee-rubbed Short Rib')), TIER_MAIN);
  });

  it('puts the cold small things before the tacos', () => {
    assert.equal(courseTier(dish('Kingfish Ceviche')), TIER_STARTER);
    assert.equal(courseTier(dish('Chicken Tinga Empanada (1pc)')), TIER_STARTER);
    assert.equal(courseTier(dish('Sydney Rock Oysters')), TIER_STARTER);
  });

  it('reads a taco as a taco even when it names a fish', () => {
    assert.equal(courseTier(dish('Barramundi Taco Grilled')), TIER_TACO);
    assert.equal(courseTier(dish('Beef Birria Taco')), TIER_TACO);
  });

  it('sends mains and sides down together', () => {
    for (const title of [
      'Grilled Snapper (Al Pastor base)',
      'Agave Beef Short Rib',
      'Broccolini, almond mole',
      'Green Leaf Salad (Mixed Greens)',
      'Shoestring Fries'
    ]) {
      assert.equal(courseTier(dish(title)), TIER_MAIN, title);
    }
  });

  it('lands an unrecognised dish with the mains rather than early', () => {
    assert.equal(courseTier(dish('Chef special')), TIER_MAIN);
    assert.equal(courseTier(dish('')), TIER_MAIN);
  });
});

describe('planCourseFlow', () => {
  it('flows the Feasting menu the way service runs it', () => {
    assert.deepEqual(planCourseFlow(FEASTING), [
      NOW,        // Guacamole & Tostadas
      'Course 1', // Kingfish Ceviche
      'Course 2', // Barramundi Taco
      'Course 2', // Beef Birria Taco
      'Course 3', // Grilled Snapper
      'Course 3', // Agave Beef Short Rib
      'Course 3', // Broccolini
      'Course 3', // Green Leaf Salad
      'Course 3'  // Shoestring Fries
    ]);
  });

  it('flows the Grazing menu, which has no mains — the sides come last on their own', () => {
    assert.deepEqual(planCourseFlow(GRAZING), [
      NOW,
      'Course 1',
      'Course 1',
      'Course 2',
      'Course 2',
      'Course 3',
      'Course 3',
      'Course 3'
    ]);
  });

  it('numbers only the sittings a menu uses, leaving no gap', () => {
    // Bottomless stops after the tacos: Course 1 then Course 2, never
    // Course 1 then Course 3.
    const flow = planCourseFlow(BOTTOMLESS);
    assert.deepEqual(flow, [NOW, 'Course 1', 'Course 2', 'Course 2', NOW, NOW, NOW]);
    assert.equal(flow.includes('Course 3'), false);
  });

  it('gives a menu that is only drinks and dips nothing but NOW', () => {
    assert.deepEqual(planCourseFlow([dish('Guacamole & Tostadas'), dish('Corona', 'Beer')]), [NOW, NOW]);
  });

  it('returns one name per dish, in the order given', () => {
    assert.equal(planCourseFlow(FEASTING).length, FEASTING.length);
    assert.deepEqual(planCourseFlow([]), []);
  });

  it('starts at Course 1 even when the menu opens with a main', () => {
    assert.deepEqual(planCourseFlow([dish('Agave Beef Short Rib'), dish('Shoestring Fries')]), ['Course 1', 'Course 1']);
  });
});

// ── The drink test, pinned ──────────────────────────────────────────────────
//
// This predicate had three copies: apps/api's kindBucket, the regex here, and
// a private list of five wine categories in seed-dish-menu.ts. The third one
// was wrong, and it made the seeder report 326 unchecked "dishes" when most of
// them were mezcal. These cases exist so the shared one cannot quietly drift.
describe('isDrink', () => {
  it('calls the bar list drinks, whatever the category is named', () => {
    for (const [kind, category] of [
      ['Bar Dish', 'Mezcal'],
      ['Bar Dish', 'Cocktails'],
      ['Bar Dish', 'Spirits'],
      ['Bar Dish', 'Gin'],
      ['Bar Dish', 'Red Wine'],
      ['Bar Dish', 'Tequila'],
      ['BEVERAGE', 'Coffee']
    ] as const) {
      assert.equal(isDrink(kind, category), true, `${kind} / ${category} should be a drink`);
    }
  });

  it('calls food food, including dishes named after drinks', () => {
    // Why this reads kind and category rather than the title: "beer-battered"
    // and "tequila prawns" are dishes, and a title-based rule sends them to
    // the bar.
    for (const [kind, category] of [
      ['Dish', 'Snacks'],
      ['Dish', 'Sides'],
      ['Dish', 'Tacos'],
      ['Dish', 'Sweet'],
      ['Dish', null]
    ] as const) {
      assert.equal(isDrink(kind, category), false, `${kind} / ${category} should be food`);
    }
  });

  it('treats an unclassified item as food rather than a drink', () => {
    // Unmarked food still needs allergen attention. A dish quietly reclassified
    // as a drink would drop out of the very report that exists to catch it.
    assert.equal(isDrink(null, null), false);
    assert.equal(isDrink(undefined, undefined), false);
  });
});
