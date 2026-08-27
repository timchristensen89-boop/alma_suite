import assert from 'node:assert/strict';
import test from 'node:test';
import { effectivePriceCents, menuForDay, offeredOnDay, windowApplies } from '@alma/shared';

const TUESDAY = 2;
const WEDNESDAY = 3;
const tacoTuesday = { weekdays: '2', priceCents: 500, label: 'Taco Tuesday' };
const boardWindow = { weekdays: '2', priceCents: 2000, onlyWindow: true, label: 'Taco Tuesday' };

test('a window applies on its own days and nowhere else', () => {
  assert.equal(windowApplies('2', TUESDAY), true);
  assert.equal(windowApplies('2', WEDNESDAY), false);
  assert.equal(windowApplies('0,6', 0), true);
  assert.equal(windowApplies('', TUESDAY), false);
  // The csv survives spaces — '0, 6' is how a human types it.
  assert.equal(windowApplies('0, 6', 6), true);
});

test('Tuesday rings the window price, Wednesday the base', () => {
  assert.equal(effectivePriceCents(800, [tacoTuesday], TUESDAY), 500);
  assert.equal(effectivePriceCents(800, [tacoTuesday], WEDNESDAY), 800);
  assert.equal(effectivePriceCents(800, undefined, TUESDAY), 800);
});

test('an ordinary window never hides the dish', () => {
  assert.equal(offeredOnDay([tacoTuesday], WEDNESDAY), true);
});

test('an onlyWindow dish exists on its days and no others', () => {
  assert.equal(offeredOnDay([boardWindow], TUESDAY), true);
  assert.equal(offeredOnDay([boardWindow], WEDNESDAY), false);
});

test('a price tweak alongside an onlyWindow row does not resurrect the dish', () => {
  // Somebody adds a Sunday special price to the Tuesday-only board: the board
  // is still window-bound, and Sunday is not one of its days.
  const sundayTweak = { weekdays: '0', priceCents: 1800 };
  assert.equal(offeredOnDay([boardWindow, sundayTweak], 0), false);
  assert.equal(offeredOnDay([boardWindow, sundayTweak], TUESDAY), true);
});

test('menuForDay bakes prices, drops out-of-window dishes, and reprices variants', () => {
  const categories = [
    {
      name: 'Tacos',
      items: [
        { title: 'Beef Birria Taco', priceCents: 800, priceWindows: [tacoTuesday] },
        { title: 'Try Them All Taco Board', priceCents: 2000, priceWindows: [boardWindow] },
        {
          title: 'Barramundi Taco',
          priceCents: 800,
          priceWindows: [tacoTuesday],
          variants: [
            { label: 'Battered', priceCents: 800, priceWindows: [tacoTuesday] },
            { label: 'Grilled', priceCents: 800, priceWindows: [tacoTuesday] }
          ]
        }
      ]
    }
  ];
  const tuesday = menuForDay(categories, TUESDAY);
  assert.equal(tuesday[0]!.items.length, 3);
  assert.equal(tuesday[0]!.items[0]!.priceCents, 500);
  assert.equal(tuesday[0]!.items[1]!.priceCents, 2000);
  assert.deepEqual(tuesday[0]!.items[2]!.variants?.map((option) => option.priceCents), [500, 500]);

  const wednesday = menuForDay(categories, WEDNESDAY);
  assert.equal(wednesday[0]!.items.length, 2);
  assert.equal(wednesday[0]!.items.map((item) => item.title).includes('Try Them All Taco Board'), false);
  assert.equal(wednesday[0]!.items[0]!.priceCents, 800);
  assert.deepEqual(wednesday[0]!.items[1]!.variants?.map((option) => option.priceCents), [800, 800]);

  // The source menu is untouched — the register derives per day, it does not
  // rewrite its cache.
  assert.equal(categories[0]!.items[0]!.priceCents, 800);
  assert.equal(categories[0]!.items.length, 3);
});
