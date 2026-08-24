import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DISH_DIETARY, dishAnswersGuest, guestTagIsAllergy, parseDishDietary, answerableGuestTags } from '@alma/shared';

describe('parseDishDietary', () => {
  it('keeps the tags it knows', () => {
    assert.deepEqual(parseDishDietary(['gf', 'vgn']), ['gf', 'vgn']);
  });

  it('drops anything it does not know, so a typo cannot become a claim', () => {
    assert.deepEqual(parseDishDietary(['gf', 'glutenfree', 'GLUTEN', 42, null]), ['gf']);
  });

  it('is case and whitespace forgiving on the tags it does know', () => {
    assert.deepEqual(parseDishDietary([' GF ', 'Df']), ['gf', 'df']);
  });

  it('de-duplicates and orders stably, so two dishes read the same', () => {
    assert.deepEqual(parseDishDietary(['vgn', 'gf', 'gf']), ['gf', 'vgn']);
  });

  it('treats anything that is not a list as no tags', () => {
    assert.deepEqual(parseDishDietary(null), []);
    assert.deepEqual(parseDishDietary('gf'), []);
    assert.deepEqual(parseDishDietary(undefined), []);
  });
});

describe('dishAnswersGuest — the safety rule', () => {
  it('an UNMARKED dish is unknown, never yes', () => {
    // The whole menu starts unmarked. If this ever returns 'yes' a coeliac
    // gets handed a plate of tortillas.
    for (const guest of answerableGuestTags()) {
      assert.equal(dishAnswersGuest([], guest), 'unknown', `${guest} on an unmarked dish`);
    }
  });

  it('a dish tagged for something else is still unknown for gluten', () => {
    assert.equal(dishAnswersGuest(['vgn'], 'GF'), 'unknown');
  });

  it('never answers a requirement it has no rule for', () => {
    assert.equal(dishAnswersGuest(['gf'], 'Halal'), 'unknown');
    assert.equal(dishAnswersGuest(['gf'], 'Allergy — see note'), 'unknown');
  });
});

describe('dishAnswersGuest — suits and on-ask', () => {
  it('answers yes when the dish is tagged for it', () => {
    assert.equal(dishAnswersGuest(['gf'], 'GF'), 'yes');
    assert.equal(dishAnswersGuest(['df'], 'DF'), 'yes');
    assert.equal(dishAnswersGuest(['vgn'], 'Vegan'), 'yes');
  });

  it('answers ask when the kitchen can make it work', () => {
    assert.equal(dishAnswersGuest(['gfo'], 'GF'), 'ask');
    assert.equal(dishAnswersGuest(['vgno'], 'Vegan'), 'ask');
  });

  it('prefers a plain yes over an on-ask when a dish carries both', () => {
    assert.equal(dishAnswersGuest(['gf', 'gfo'], 'GF'), 'yes');
  });

  it('counts a vegan dish as vegetarian, but not the other way round', () => {
    assert.equal(dishAnswersGuest(['vgn'], 'Vegetarian'), 'yes');
    assert.equal(dishAnswersGuest(['veg'], 'Vegan'), 'unknown');
  });
});

describe('dishAnswersGuest — allergies', () => {
  it('rules a dish out on a contains tag', () => {
    assert.equal(dishAnswersGuest(['nuts'], 'Nut allergy'), 'no');
    assert.equal(dishAnswersGuest(['shellfish'], 'Shellfish allergy'), 'no');
  });

  it('rules out even when the dish suits every other diet', () => {
    // A vegan, gluten free, dairy free dish with nuts in it is still no good
    // to a nut allergy. Ruling out beats everything.
    assert.equal(dishAnswersGuest(['gf', 'df', 'vgn', 'nuts'], 'Nut allergy'), 'no');
  });

  it('NEVER answers yes to an allergy — other tags are not an allergen check', () => {
    // This used to say 'yes': "tagged for anything counts as checked". But a
    // dish walked for the printed GF/DF marks was never checked for
    // shellfish — a prawn tostada tagged gf·df read as SUITABLE for a
    // shellfish allergy. The absence of a contains tag is not a safety claim.
    assert.equal(dishAnswersGuest(['gf'], 'Nut allergy'), 'unknown');
    assert.equal(dishAnswersGuest(['gf', 'df', 'vgn'], 'Shellfish allergy'), 'unknown');
  });

  it('will not clear a dish nobody has checked', () => {
    assert.equal(dishAnswersGuest([], 'Nut allergy'), 'unknown');
  });

  it('keeps the two allergies apart — and neither reads as a clean bill for the other', () => {
    assert.equal(dishAnswersGuest(['nuts'], 'Shellfish allergy'), 'unknown');
    assert.equal(dishAnswersGuest(['shellfish'], 'Nut allergy'), 'unknown');
  });

  it('knows which guest tags are allergies (exclude-only)', () => {
    assert.equal(guestTagIsAllergy('Nut allergy'), true);
    assert.equal(guestTagIsAllergy('Shellfish allergy'), true);
    assert.equal(guestTagIsAllergy('GF'), false);
    assert.equal(guestTagIsAllergy('Vegan'), false);
    assert.equal(guestTagIsAllergy('Halal'), false);
  });
});

describe('DISH_DIETARY', () => {
  it('has no duplicate ids or short labels', () => {
    assert.equal(new Set(DISH_DIETARY.map((t) => t.id)).size, DISH_DIETARY.length);
    assert.equal(new Set(DISH_DIETARY.map((t) => t.short)).size, DISH_DIETARY.length);
  });

  it('marks every tag as exactly one kind', () => {
    for (const tag of DISH_DIETARY) {
      assert.ok(['suits', 'onAsk', 'contains'].includes(tag.kind), `${tag.id} is ${tag.kind}`);
    }
  });
});
