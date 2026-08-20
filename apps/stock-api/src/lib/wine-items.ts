/**
 * Turning a row of the printed wine list into a register item — and spotting
 * the ones already in the register that are priced wrongly.
 *
 * Pure so both can be tested without a database, because both write to things
 * staff sell from: one creates sellable items, the other changes a price.
 * Covered by wine-items.test.ts.
 */

import type { WineListRow } from './wine-list.js';

/**
 * The printed list's headings, mapped to the four categories the register
 * actually files wine under (Red Wine / White Wine / Rose / Sparkling Wine).
 *
 * "Skin contact & orange" is white fruit however it is made, and both Mexican
 * wines on the list are Cabernet reds. "Sweet & fortified" is deliberately
 * absent: a Rutherglen Muscat is none of the four, and inventing a category
 * for it would put it somewhere nobody looks. It gets reported instead.
 */
const SECTION_CATEGORY = new Map<string, string>([
  ['chardonnay', 'White Wine'],
  ['other whites', 'White Wine'],
  ['white', 'White Wine'],
  ['sauvignon blanc & semillon', 'White Wine'],
  ['riesling', 'White Wine'],
  ['skin contact & orange', 'White Wine'],
  ['other reds', 'Red Wine'],
  ['shiraz', 'Red Wine'],
  ['red', 'Red Wine'],
  ['pinot noir', 'Red Wine'],
  ['cabernet & bordeaux blends', 'Red Wine'],
  ['mexican wine', 'Red Wine'],
  ['rosé', 'Rose'],
  ['rose', 'Rose'],
  ['bubbles', 'Sparkling Wine']
]);

/** NULL when the list's heading has no home in the register's four. */
export function sectionCategory(section: string | null): string | null {
  if (!section) return null;
  return SECTION_CATEGORY.get(section.trim().toLowerCase()) ?? null;
}

/**
 * The register's own naming, read off the items already in it: producer, then
 * the cuvée, then the grape, then the pour — "Haddow & Dineen Private Universe
 * Pinot Noir 750mL". No quotes; the register is inconsistent about them and
 * the matcher ignores punctuation anyway.
 *
 * A grape already said by the producer or the cuvée is not said twice, which
 * is why "Villa Albergotti Chianti Superiore" does not become "...Sangiovese".
 *
 * Nor is a long blend spelled out. The register calls it "Chateau Domecq
 * 750mL", not "...Cabernet Sauvignon Merlot Nebbiolo", and "Pol Roger Brut
 * Rose 750mL" rather than naming three Champagne grapes — because that is what
 * the floor calls them. One or two grapes is the wine's name and stays; three
 * or more is a spec sheet, and lives on the Wine record where the list page
 * reads it.
 */
const GRAPES_WORTH_SAYING = 2;

export function itemTitle(row: Pick<WineListRow, 'producer' | 'cuvee' | 'grape'>, ml: number): string {
  const said = new Set(
    `${row.producer} ${row.cuvee ?? ''}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
  const words = (row.grape ?? '')
    .split(/\s+/)
    .filter((word) => word && !said.has(word.toLowerCase()));
  const grape = words.length > GRAPES_WORTH_SAYING ? '' : words.join(' ');
  return [row.producer, row.cuvee, grape, `${ml}mL`]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type SiblingPour = {
  ml: number;
  /** What the printed list charges. */
  menuCents: number;
  /** What the register charges now. NULL = never priced. */
  registerCents: number | null;
};

/**
 * A pour priced above a LARGER pour of the same wine, which no list ever does.
 * It is always a typo — a 150mL glass of Catalina Sounds rang at $105 against
 * a $76 bottle, because someone typed the wrong box.
 */
export function outlierPours(pours: SiblingPour[]): SiblingPour[] {
  return pours.filter((pour) =>
    pour.registerCents !== null &&
    pours.some(
      (other) =>
        other.ml > pour.ml && other.registerCents !== null && other.registerCents < (pour.registerCents ?? 0)
    )
  );
}

/**
 * What a mis-priced pour SHOULD ring at, taken from how its siblings are
 * priced rather than from the menu directly.
 *
 * The register currently sits a dollar under the new printed list nearly
 * everywhere, because the list's price rise is not live until the print is
 * signed off. Writing the menu price onto one pour would raise it early and
 * leave the other two sizes of the same wine behind. So: take the offset the
 * wine's other pours already carry, and apply it here.
 *
 * With no priced siblings to learn from, the menu price is the only number
 * there is, and it is used.
 */
export function impliedPrice(menuCents: number, siblings: SiblingPour[]): number {
  const offsets = siblings
    .filter((pour) => pour.registerCents !== null)
    .map((pour) => (pour.registerCents ?? 0) - pour.menuCents)
    .sort((a, b) => a - b);
  if (offsets.length === 0) return menuCents;
  const middle = Math.floor(offsets.length / 2);
  const offset =
    offsets.length % 2 === 1
      ? offsets[middle] ?? 0
      : Math.round(((offsets[middle - 1] ?? 0) + (offsets[middle] ?? 0)) / 2);
  return Math.max(0, menuCents + offset);
}
