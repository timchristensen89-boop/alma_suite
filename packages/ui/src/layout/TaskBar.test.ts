import test from 'node:test';
import assert from 'node:assert/strict';
import { splitTaskBarItems, type TaskBarItem } from './TaskBar.js';

/**
 * What lands on the phone task bar and what goes behind More.
 *
 * Five slots is a physical limit rather than a preference: a sixth target on a
 * 375px screen is 62px wide, and a mis-tap on "Wastage" when you meant
 * "Transfer" costs somebody a correction later.
 */

const item = (key: string, extra: Partial<TaskBarItem> = {}): TaskBarItem => ({
  key,
  label: key,
  href: `/${key}`,
  ...extra
});

test('five or fewer items all sit on the bar, with no More', () => {
  const items = ['home', 'clock', 'roster', 'leave', 'checks'].map((k) => item(k));
  const { onBar, overflow } = splitTaskBarItems(items, 5);
  assert.equal(onBar.length, 5);
  assert.deepEqual(overflow, []);
});

test('past five, the last slot becomes More', () => {
  const items = ['home', 'clock', 'roster', 'leave', 'checks', 'tips'].map((k) => item(k));
  const { onBar, overflow } = splitTaskBarItems(items, 5);
  // Four on the bar; the fifth slot is the More button the component adds.
  assert.equal(onBar.length, 4);
  assert.equal(overflow.length, 2);
});

test('the screen you are on stays visible, even when it would have overflowed', () => {
  // Stock has more tasks than slots. If you are on Orders, Orders must not
  // disappear into a sheet the moment you arrive there.
  const items = ['count', 'wastage', 'transfer', 'delivery', 'orders', 'items', 'suppliers'].map((k) =>
    item(k, k === 'orders' ? { active: true } : {})
  );
  const { onBar, overflow } = splitTaskBarItems(items, 5);
  assert.ok(onBar.some((i) => i.key === 'orders'), 'the active screen should be on the bar');
  assert.ok(!overflow.some((i) => i.key === 'orders'));
});

test('items marked primary are kept on the bar', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => item(k, k === 'f' ? { primary: true } : {}));
  const { onBar } = splitTaskBarItems(items, 5);
  assert.ok(onBar.some((i) => i.key === 'f'));
});

test('nothing is lost — every item is either on the bar or in the sheet', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => item(k));
  const { onBar, overflow } = splitTaskBarItems(items, 5);
  assert.equal(onBar.length + overflow.length, items.length);
  assert.equal(new Set([...onBar, ...overflow].map((i) => i.key)).size, items.length);
});

test('an empty list produces an empty bar rather than a lone More button', () => {
  const { onBar, overflow } = splitTaskBarItems([], 5);
  assert.deepEqual(onBar, []);
  assert.deepEqual(overflow, []);
});
