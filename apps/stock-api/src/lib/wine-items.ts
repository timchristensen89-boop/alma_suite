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
 * Every category the register files wine under, as sectionCategory writes them.
 */
export const WINE_CATEGORIES = ['Red Wine', 'White Wine', 'Rose', 'Sparkling Wine', 'Fortified'] as const;

/**
 * "This recipe is a wine, however it happens to be filed" — as a Prisma
 * predicate, in one place.
 *
 * It used to be four hand-copied OR blocks across wines.service.ts and three
 * scripts. Adding Fortified meant editing all four, and missing one would have
 * left the Muscat invisible to whichever script was missed while every other
 * script happily created it again. Substrings rather than exact names because
 * the legacy import is inconsistent ("Wine", "Red Wine", "Wine - Red").
 */
export const WINE_CATEGORY_FILTER = {
  OR: [
    { category: { contains: 'Wine', mode: 'insensitive' as const } },
    { category: { contains: 'Sparkling', mode: 'insensitive' as const } },
    { category: { contains: 'Rose', mode: 'insensitive' as const } },
    { category: { contains: 'Fortified', mode: 'insensitive' as const } }
  ]
};

/**
 * The printed list's headings, mapped to the categories the register files
 * wine under.
 *
 * "Skin contact & orange" is white fruit however it is made, and both Mexican
 * wines on the list are Cabernet reds.
 *
 * "Sweet & fortified" was reported rather than filed until Tim named a home
 * for it, because a Rutherglen Muscat is not red, white, rosé or sparkling and
 * forcing it into one would have put it where nobody looks. Fortified is now a
 * category of its own — which is why WINE_CATEGORIES below is the list every
 * query works from rather than four hard-coded strings in four files.
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
  ['bubbles', 'Sparkling Wine'],
  ['sweet & fortified', 'Fortified'],
  ['fortified', 'Fortified']
]);

/** NULL when the list's heading has no home among WINE_CATEGORIES. */
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

/**
 * A subcategory that names a drink family which is not wine.
 *
 * The register's wine items carry a legacy free-text subcategory from the
 * import, and a handful of wines came across filed under "Cocktails" — a
 * Chenin Blanc at St Alma and a Tempranillo at Avalon among them. It is
 * harmless at the register (the POS never reads subcategory) but it is the
 * sub-label under the title in Stock, so those wines read as cocktails to
 * whoever is looking at the list.
 *
 * The test is deliberately narrow: it fires only when the text names a
 * DIFFERENT drink family and says nothing about wine. "Wine by the glass"
 * mentions wine and stays. "Bubbles" names no other family and stays — an
 * unfamiliar subcategory is unknown, not wrong, and this must not quietly
 * strip labels somebody chose on purpose.
 */
const OTHER_DRINK_FAMILY =
  /cocktail|beer|cider|spirit|liquor|whisk|vodka|\bgin\b|\brum\b|tequila|mezcal|coffee|\btea\b|juice|soft drink|soda|water/;
const MENTIONS_WINE = /wine|sparkling|champagne|prosecco|ros[eé]|bubbles|vermouth|sherry|\bport\b|muscat|fortified|sake/;

export function contradictsWine(subcategory: string | null | undefined): boolean {
  const value = (subcategory ?? '').trim().toLowerCase();
  if (!value) return false;
  if (MENTIONS_WINE.test(value)) return false;
  return OTHER_DRINK_FAMILY.test(value);
}

export type WineShape = {
  kind: string | null;
  subcategory: string | null;
  /** The neighbour this shape reads like, for the report. */
  from: string;
};

type Neighbour = { title: string; kind: string | null; subcategory: string | null };

/** Most frequent value, ties going to whichever was seen first. */
function commonest<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The shape a new wine should be created with, read off the wines already in
 * the register beside it.
 *
 * Taking the FIRST neighbour — which is what this used to do — means one badly
 * filed legacy row decides how every new wine at that venue is filed. Taking
 * the commonest means it takes a vote, and one odd row loses. Neighbours whose
 * subcategory names another drink family are not counted at all, so a pool
 * that happens to be mostly mislabelled still cannot pass the mislabel on:
 * blank is a worse label than the right one and a better one than a wrong one.
 */
export function dominantShape(neighbours: Neighbour[]): WineShape | null {
  if (neighbours.length === 0) return null;
  const kind = commonest(neighbours.map((neighbour) => neighbour.kind)) ?? null;
  const usable = neighbours.filter((neighbour) => !contradictsWine(neighbour.subcategory));
  const subcategory = usable.length === 0 ? null : (commonest(usable.map((n) => n.subcategory)) ?? null);
  const from =
    usable.find((n) => n.kind === kind && n.subcategory === subcategory)?.title ??
    usable.find((n) => n.subcategory === subcategory)?.title ??
    neighbours.find((n) => n.kind === kind)?.title ??
    neighbours[0]?.title ??
    '';
  return { kind, subcategory, from };
}
