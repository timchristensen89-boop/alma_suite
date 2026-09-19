import assert from 'node:assert/strict';
import test from 'node:test';
import { isKitchenRole } from '@alma/shared';

/*
 * Kitchen staff get Stock on top of the standard access, and there is no
 * department field — the role title and the default roster area are what the
 * register knows. These pin the reading of both.
 */
test('kitchen is read from the role title', () => {
  for (const roleTitle of ['Head Chef', 'Sous chef', 'Commis Chef', 'Cook', 'Kitchen hand', 'KP', 'Pastry chef', 'Dish hand', 'Prep cook']) {
    assert.equal(isKitchenRole({ roleTitle }), true, roleTitle);
  }
});

test('front of house is not kitchen', () => {
  for (const roleTitle of ['Floor Staff', 'Bartender', 'Venue Manager', 'Duty Manager', 'Host', 'Barista', 'Owner / Master Admin']) {
    assert.equal(isKitchenRole({ roleTitle }), false, roleTitle);
  }
});

test('the default roster area decides when the title does not', () => {
  assert.equal(isKitchenRole({ roleTitle: 'Staff', defaultArea: 'Kitchen' }), true);
  assert.equal(isKitchenRole({ roleTitle: 'Staff', defaultArea: ' kitchen ' }), true);
  assert.equal(isKitchenRole({ roleTitle: 'Staff', defaultArea: 'Floor' }), false);
  assert.equal(isKitchenRole({ roleTitle: null, defaultArea: null }), false);
  assert.equal(isKitchenRole({}), false);
});

test('short tokens only match as whole words', () => {
  // "kp" and "prep" are real kitchen titles; "prepared" and "skipper" are not.
  assert.equal(isKitchenRole({ roleTitle: 'Skipper' }), false);
  assert.equal(isKitchenRole({ roleTitle: 'Well prepared host' }), false);
});
