/**
 * Weekday price windows — Taco Tuesday without anybody re-keying prices.
 *
 * A window says: on these weekdays, this dish sells at THIS price. A window
 * marked onlyWindow goes further: outside its days the dish is not offered at
 * all (the "Try them all" taco board exists on Tuesdays and nowhere else).
 *
 * Pure on purpose, because the same arithmetic runs in three places and they
 * must never disagree:
 *
 *   - the register, against the DEVICE's day — an offline register keeps
 *     ringing the right price from its cached menu;
 *   - the QR menu, server-side in the venue's timezone — a guest browsing on
 *     Tuesday sees Tuesday's price;
 *   - the QR order, server-side again — guest prices are never trusted from
 *     the client, so the reprice has to reach the same number the menu showed.
 *
 * Weekdays are JS day numbers 0-6 in a csv, the same shape PosRule already
 * uses for the weekend surcharge.
 */

export type PriceWindow = {
  weekdays: string;
  priceCents: number;
  onlyWindow?: boolean;
  label?: string;
};

export function windowApplies(weekdaysCsv: string, weekday: number): boolean {
  return weekdaysCsv
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .map(Number)
    .includes(weekday);
}

/** The price a dish takes on this weekday: its first applying window, else base. */
export function effectivePriceCents(basePriceCents: number, windows: PriceWindow[] | null | undefined, weekday: number): number {
  for (const window of windows ?? []) {
    if (windowApplies(window.weekdays, weekday)) return window.priceCents;
  }
  return basePriceCents;
}

/**
 * Whether the dish is offered at all on this weekday.
 *
 * Ordinary windows only change the price. But if EVERY window on a dish is
 * onlyWindow, the dish lives inside its windows: offered only when one
 * applies. A mixed set (some onlyWindow, some not) still counts as
 * window-bound — an onlyWindow row is a deliberate statement about when the
 * dish exists, and an unrelated price tweak must not quietly cancel it.
 */
export function offeredOnDay(windows: PriceWindow[] | null | undefined, weekday: number): boolean {
  const bounding = (windows ?? []).filter((window) => window.onlyWindow);
  if (bounding.length === 0) return true;
  return bounding.some((window) => windowApplies(window.weekdays, weekday));
}

type WindowedItem = {
  priceCents: number;
  priceWindows?: PriceWindow[] | null;
  variants?: Array<{ priceCents: number; priceWindows?: PriceWindow[] | null }> | null;
};

type WindowedCategory<Item extends WindowedItem> = { items: Item[] };

/**
 * The menu as it stands on one weekday: window prices baked into priceCents
 * (variants included), dishes outside their windows dropped. Categories keep
 * their other fields; emptied categories are kept (callers already skip
 * empty categories where it matters).
 */
export function menuForDay<Item extends WindowedItem, Category extends WindowedCategory<Item>>(
  categories: Category[],
  weekday: number
): Category[] {
  return categories.map((category) => ({
    ...category,
    items: category.items
      .filter((item) => offeredOnDay(item.priceWindows, weekday))
      .map((item) => {
        const priced: Item = { ...item, priceCents: effectivePriceCents(item.priceCents, item.priceWindows, weekday) };
        if (item.variants) {
          priced.variants = item.variants
            .filter((option) => offeredOnDay(option.priceWindows, weekday))
            .map((option) => ({ ...option, priceCents: effectivePriceCents(option.priceCents, option.priceWindows, weekday) }));
        }
        return priced;
      })
  }));
}
