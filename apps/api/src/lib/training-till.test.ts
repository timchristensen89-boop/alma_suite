import assert from 'node:assert/strict';
import test from 'node:test';
import { isTrainingSafeTender, orderIsTraining, sessionTrainingOnly } from './training-till.js';

// ── Which way the flag combines ─────────────────────────────────────────────

test('a training PIN on a live till is training', () => {
  // The new starter case. Their practice must not become somebody's takings.
  assert.equal(sessionTrainingOnly(false, true), true);
});

test('a live PIN on a training till is training', () => {
  // The other half: the practice iPad does not become a real register because
  // a real staff member picked it up.
  assert.equal(sessionTrainingOnly(true, false), true);
});

test('only both-live is live', () => {
  assert.equal(sessionTrainingOnly(false, false), false);
  assert.equal(sessionTrainingOnly(undefined, undefined), false);
});

test('the combination widens, unlike everything else about a device session', () => {
  // Stated as its own case because this is the line most likely to be
  // "tidied" into an AND by somebody matching the surrounding code, where
  // admin, role and app access all narrow.
  assert.equal(sessionTrainingOnly(true, true), true);
  assert.notEqual(sessionTrainingOnly(true, false), false);
});

// ── What the client may ask for ─────────────────────────────────────────────

test('a live account may still ask for a practice bill', () => {
  assert.equal(orderIsTraining(true, false), true);
});

test('a training account never gets a live bill, whatever the client sends', () => {
  assert.equal(orderIsTraining(false, true), true);
  assert.equal(orderIsTraining(undefined, true), true);
  // Including the case that matters: a client that has been tampered with, or
  // an old build that does not know about the account flag at all.
  assert.equal(orderIsTraining('no', true), true);
  assert.equal(orderIsTraining(0, true), true);
});

test('only an honest request from a live account opens a live bill', () => {
  assert.equal(orderIsTraining(false, false), false);
  assert.equal(orderIsTraining(undefined, undefined), false);
});

test('training is asserted, never implied', () => {
  // Anything other than a literal `true` from the client is not a request for
  // a practice bill — the body is untrusted and 'true' is a string.
  assert.equal(orderIsTraining('true', false), false);
  assert.equal(orderIsTraining(1, false), false);
});

// ── What a training bill may tender ─────────────────────────────────────────

test('cash and the standalone card machine are safe to practise on', () => {
  // Both are records of money that moved somewhere we do not control, and the
  // training row is excluded from takings and the drawer regardless.
  assert.ok(isTrainingSafeTender('CASH'));
  assert.ok(isTrainingSafeTender('CARD_EXTERNAL'));
});

test('everything that really moves money is refused', () => {
  // A gift card is really debited and a terminal really charges a card. No
  // amount of flagging the row afterwards gives the money back.
  for (const method of ['GIFT_CARD', 'STRIPE_TERMINAL', 'SQUARE_TERMINAL', 'ONLINE']) {
    assert.equal(isTrainingSafeTender(method), false, `${method} must not be usable on a training bill`);
  }
});

test('an unknown tender is not safe by default', () => {
  // A new payment method added later is refused on a training bill until
  // somebody decides it belongs on the list.
  assert.equal(isTrainingSafeTender('CRYPTO'), false);
  assert.equal(isTrainingSafeTender(''), false);
});
