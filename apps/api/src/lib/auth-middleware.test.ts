import assert from 'node:assert/strict';
import test from 'node:test';
import { isStaffWriteAllowed } from './auth-middleware.js';

/*
 * What a plain staff session (role STAFF — a floor staffer's own login, or a
 * PIN on the venue till) may write without a manager. Everything not listed
 * here answers "This is a manager-only action."
 */
const allowed = (method: string, path: string) => isStaffWriteAllowed({ method, path });

test('a staff member can take, send and settle an order on the till', () => {
  assert.equal(allowed('POST', '/api/pos/orders'), true);
  assert.equal(allowed('PATCH', '/api/pos/orders/ord_1'), true);
  assert.equal(allowed('PUT', '/api/pos/orders/ord_1/lines'), true);
  assert.equal(allowed('POST', '/api/pos/orders/ord_1/send'), true);
  assert.equal(allowed('POST', '/api/pos/orders/ord_1/pay'), true);
  assert.equal(allowed('POST', '/api/pos/orders/ord_1/split-evenly'), true);
  assert.equal(allowed('POST', '/api/pos/orders/ord_1/terminal-checkout'), true);
  assert.equal(allowed('POST', '/api/pos/terminal-checkouts/chk_1/cancel'), true);
  assert.equal(allowed('POST', '/api/pos/orders/ord_1/gift-cards'), true);
  assert.equal(allowed('DELETE', '/api/pos/orders/ord_1/gift-cards/sale_1'), true);
  assert.equal(allowed('POST', '/api/pos/kds/tk_1/bump'), true);
  assert.equal(allowed('POST', '/api/pos/service-calls/sc_1/clear'), true);
  assert.equal(allowed('POST', '/api/pos/wastage'), true);
  assert.equal(allowed('POST', '/api/pos/eighty-six'), true);
  assert.equal(allowed('PATCH', '/api/pos/tables/t_1/position'), true);
});

test('reversals pass the middleware because the service demands a manager PIN', () => {
  assert.equal(allowed('POST', '/api/pos/orders/ord_1/void'), true);
  assert.equal(allowed('POST', '/api/pos/orders/ord_1/reopen'), true);
  assert.equal(allowed('POST', '/api/pos/orders/ord_1/refund'), true);
  assert.equal(allowed('POST', '/api/pos/manager-approve'), true);
});

test('discounts, the drawer, day close and every setup write stay manager-only', () => {
  // Nothing in the POS service checks a PIN for these — this rule is their gate.
  assert.equal(allowed('POST', '/api/pos/orders/ord_1/discount'), false);
  assert.equal(allowed('POST', '/api/pos/orders/ord_1/lines/line_1/adjust'), false);
  assert.equal(allowed('POST', '/api/pos/orders/ord_1/payments/pay_1/undo'), false);
  assert.equal(allowed('POST', '/api/pos/open-drawer'), false);
  assert.equal(allowed('POST', '/api/pos/drawer/close'), false);
  assert.equal(allowed('POST', '/api/pos/close-day'), false);
  assert.equal(allowed('POST', '/api/pos/specials'), false);
  assert.equal(allowed('PUT', '/api/pos/venue-settings'), false);
  assert.equal(allowed('PUT', '/api/pos/loyalty/settings'), false);
  assert.equal(allowed('POST', '/api/pos/loyalty/adjust'), false);
  assert.equal(allowed('POST', '/api/pos/printer-profiles'), false);
  assert.equal(allowed('POST', '/api/pos/terminals/pair'), false);
  assert.equal(allowed('DELETE', '/api/pos/terminals/term_1'), false);
  assert.equal(allowed('POST', '/api/pos/xero/push'), false);
  assert.equal(allowed('POST', '/api/pos/rules'), false);
});

test('gift card redemption is everyone\'s job; the rest of gift cards is not', () => {
  assert.equal(allowed('POST', '/api/gift-cards/redeem'), true);
  assert.equal(allowed('POST', '/api/gift-cards/counter/checkout'), false);
  assert.equal(allowed('POST', '/api/gift-cards/cards/ABCD/cancel'), false);
  assert.equal(allowed('PATCH', '/api/gift-cards/settings'), false);
});

test('roster self-service was already open and stays open', () => {
  assert.equal(allowed('POST', '/api/staff/me/leave'), true);
  assert.equal(allowed('POST', '/api/staff/me/shifts/shift_1/offer-swap'), true);
  assert.equal(allowed('POST', '/api/staff/me/open-shifts/shift_1/claim'), true);
  assert.equal(allowed('PUT', '/api/staff/me/availability'), true);
  // The builder is a manager's.
  assert.equal(allowed('POST', '/api/staff/roster'), false);
  assert.equal(allowed('POST', '/api/staff/roster/publish'), false);
});

test('reads are never the question', () => {
  assert.equal(allowed('GET', '/api/pos/close-day'), true);
  assert.equal(allowed('GET', '/api/staff/roster'), true);
});
