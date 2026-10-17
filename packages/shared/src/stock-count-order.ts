/**
 * How a stock count is laid out — on screen, on the printed sheet and in the
 * Excel template — in one place, so the three can never disagree.
 *
 * Three rules:
 *
 * 1. Categories follow the walk, not the alphabet: spirits, liqueurs, wine,
 *    beer, soft drinks, then the kitchen. Anything not in the list follows in
 *    alphabetical order, and made (prep) items always come last.
 *
 * 2. Wine groups by the wine, then the vintage. The catalogue writes vintages
 *    both ways round ("2022 Teusner 'Wark Family' Shiraz (Case of 12)" from an
 *    invoice, "Rockford Basket Press Shiraz 2017" from the floor), so sorting
 *    by name scattered one wine's vintages across the list and filed every
 *    invoice-created wine under "2". Each vintage stays its own stock item —
 *    this only changes where it prints.
 *
 * 3. Search is forgiving: every word typed must appear somewhere in the name,
 *    in any order, ignoring case, accents and punctuation — so "shaw 2024",
 *    "smith m3" and "Shaw + Smith" all find "2024 Shaw & Smith 'M3' Chardonnay".
 *
 * Names are never rewritten here. Two items are only shown together when
 * their names match exactly once vintage, case size and punctuation are set
 * aside — similar-looking wines ("Bruxo No. 2" / "No. 4") stay apart.
 */

export const PREP_COUNT_CATEGORY = 'Prep (made items)';
/** Prepared products counted as stock items, each its own section. */
export const BATCH_COCKTAILS_CATEGORY = 'Batch Cocktails';
export const KITCHEN_PREP_CATEGORY = 'Kitchen Prep';
export const PREPARED_STOCK_CATEGORIES = [BATCH_COCKTAILS_CATEGORY, KITCHEN_PREP_CATEGORY] as const;
export function isPreparedStockCategory(category: string | null | undefined): boolean {
  const folded = foldText(category ?? '');
  return PREPARED_STOCK_CATEGORIES.some((name) => foldText(name) === folded);
}
export const UNCATEGORISED_COUNT_CATEGORY = 'Uncategorised';

/**
 * The order a bar-and-kitchen count is walked in. Names match the existing
 * StockCategory rows; anything missing from this list sorts after it,
 * alphabetically.
 */
export const STOCK_COUNT_CATEGORY_ORDER = [
  'Spirits — Tequila & Mezcal',
  'Spirits — Other',
  'Spirits',
  'Liqueurs & Aperitifs',
  'Wine — Sparkling',
  'Wine — White',
  'Wine — Rosé',
  'Wine — Red',
  'Beer & Cider',
  'Non-Alcoholic & Mixers',
  'Produce',
  'Herbs & Spices',
  'Meat & Poultry',
  'Seafood',
  'Dairy & Eggs',
  'Bakery',
  'Dry / Pantry',
  'Oils & Condiments',
  'Desserts & Sweets',
  'Frozen',
  'Other',
  // Made on site, after every bought ingredient: a batch is counted where it
  // is kept, and never inside the spirits or produce it was made from.
  'Batch Cocktails',
  'Kitchen Prep'
] as const;

const CATEGORY_RANK = new Map<string, number>(
  STOCK_COUNT_CATEGORY_ORDER.map((name, index) => [foldText(name), index])
);

/** Lower-case, accents stripped, "&"/"+" read as "and", punctuation gone. */
export function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[&+]/g, ' and ')
    .replace(/['’‘`"“”]/g, '')
    // A dot between digits is a decimal ("Surco 2.7"); any other dot is an
    // abbreviation ("No.", "N.V.", "Mt.") and must not split a group.
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compareCountCategories(a: string, b: string): number {
  if (a === b) return 0;
  // Prep is where a count ends; uncategorised is a data tail just before it.
  for (const last of [PREP_COUNT_CATEGORY, UNCATEGORISED_COUNT_CATEGORY]) {
    if (a === last) return 1;
    if (b === last) return -1;
  }
  const rankA = CATEGORY_RANK.get(foldText(a)) ?? Number.MAX_SAFE_INTEGER;
  const rankB = CATEGORY_RANK.get(foldText(b)) ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}

export function isWineCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  return /\b(wine|sparkling|champagne|ros[eé]|fortified)\b/i.test(category);
}

// A purchase-pack suffix the invoice import appends: "(Case of 12)",
// " - (CASE OF 24)". It describes how the item is bought, not what it is.
const PACK_SUFFIX = /\s*-?\s*\((?:case|carton|pack|box)\s+of\s+\d+\)\s*$/i;
// The standard bottle says nothing; a 375 mL half bottle is a different item
// and keeps its size in the name.
const STANDARD_BOTTLE = /\s*\b750\s?ml\b\s*/i;
const YEAR = '(19[5-9]\\d|20[0-4]\\d)';
const LEADING_YEAR = new RegExp(`^${YEAR}\\s+`);
const TRAILING_YEAR = new RegExp(`\\s+${YEAR}$`);
const NON_VINTAGE = /(^|\s)(nv|n\.v\.|non[- ]vintage)(?=\s|$)/i;

export type WineNameParts = {
  /** The wine without its vintage or pack suffix, as written. */
  wineName: string;
  /** Four-digit vintage, or null. */
  vintage: number | null;
  /** True when the name says NV / non-vintage. */
  nonVintage: boolean;
  /** True when the name carried a "(Case of N)" suffix. */
  packSuffix: boolean;
};

/**
 * Split a wine's catalogue name into wine and vintage. Only a year at the
 * very start or very end counts as the vintage — "Eperosa 'Magnolia 1941'
 * Semillon" is a 2022 wine named after a 1941 vineyard.
 */
export function splitWineName(name: string): WineNameParts {
  let rest = name.trim();
  const packSuffix = PACK_SUFFIX.test(rest);
  rest = rest.replace(PACK_SUFFIX, '').replace(STANDARD_BOTTLE, ' ').replace(/\s+/g, ' ').trim();
  let vintage: number | null = null;
  const leading = rest.match(LEADING_YEAR);
  if (leading) {
    vintage = Number(leading[1]);
    rest = rest.slice(leading[0].length);
  } else {
    const trailing = rest.match(TRAILING_YEAR);
    if (trailing) {
      vintage = Number(trailing[1]);
      rest = rest.slice(0, rest.length - trailing[0].length);
    }
  }
  const nonVintage = vintage === null && NON_VINTAGE.test(rest);
  if (nonVintage) rest = rest.replace(NON_VINTAGE, ' ');
  return { wineName: rest.replace(/\s+/g, ' ').trim() || name.trim(), vintage, nonVintage, packSuffix };
}

/** The key two vintages of one wine share. Exact after folding — never fuzzy. */
export function wineGroupKey(name: string): string {
  return foldText(splitWineName(name).wineName);
}

/**
 * Rewrite a wine name with a new vintage, keeping where the name already put
 * it (leading or trailing) and any pack suffix. A name with no vintage gets
 * the new one at the end. `'NV'` writes the non-vintage marker (where the
 * year was, else leading, as the catalogue writes it); `null` removes both.
 */
export function withVintage(name: string, vintage: number | 'NV' | null): string {
  const trimmed = name.trim();
  const suffixMatch = trimmed.match(PACK_SUFFIX);
  const suffix = suffixMatch ? suffixMatch[0] : '';
  const body = suffix ? trimmed.slice(0, trimmed.length - suffix.length).trim() : trimmed;
  const leading = body.match(LEADING_YEAR);
  const trailing = leading ? null : body.match(TRAILING_YEAR);
  const hadNv = NON_VINTAGE.test(body);
  const nvLeading = /^(nv|n\.v\.|non[- ]vintage)\s/i.test(body);
  let core = leading ? body.slice(leading[0].length) : trailing ? body.slice(0, body.length - trailing[0].length) : body;
  core = core.replace(NON_VINTAGE, ' ').replace(/\s+/g, ' ').trim();
  let next: string;
  if (vintage === null) next = core;
  else if (vintage === 'NV') next = hadNv && !nvLeading ? `${core} NV` : `NV ${core}`;
  else if (leading || nvLeading) next = `${vintage} ${core}`;
  else next = `${core} ${vintage}`;
  return `${next.trim()}${suffix}`;
}

export type CountRowAccessors<T> = {
  name: (row: T) => string;
  category: (row: T) => string | null | undefined;
  /** Made (prep) items print last under their own heading. */
  isPrep?: (row: T) => boolean;
};

export type CountGroupEntry<T> = {
  row: T;
  /** "2022", "NV" or "No year" inside a wine group; null otherwise. */
  vintageLabel: string | null;
  /**
   * Extra words that tell two entries with the same vintage label apart
   * ("Case of 12") — null when the label alone is enough.
   */
  detail: string | null;
};

export type CountGroup<T> = {
  key: string;
  /** The wine's name for a wine group; the item name otherwise. */
  name: string;
  wine: boolean;
  entries: Array<CountGroupEntry<T>>;
};

export type CountSection<T> = {
  category: string;
  groups: Array<CountGroup<T>>;
  rowCount: number;
};

function vintageLabelFor(parts: WineNameParts): string {
  if (parts.vintage !== null) return String(parts.vintage);
  return parts.nonVintage ? 'NV' : 'No year';
}

function vintageSortValue(parts: WineNameParts): number {
  return parts.vintage ?? 0;
}

/**
 * Lay count rows out as sections (category) → groups (one wine, or one item)
 * → entries (its vintages). Input order is irrelevant; output order is the
 * walk.
 */
export function organiseCountRows<T>(rows: T[], get: CountRowAccessors<T>): Array<CountSection<T>> {
  const sections = new Map<string, Map<string, { name: string; wine: boolean; members: Array<{ row: T; parts: WineNameParts | null }> }>>();
  for (const row of rows) {
    const prep = get.isPrep?.(row) ?? false;
    const category = prep ? PREP_COUNT_CATEGORY : get.category(row)?.trim() || UNCATEGORISED_COUNT_CATEGORY;
    const name = get.name(row).trim();
    const wine = !prep && isWineCategory(category);
    const parts = wine ? splitWineName(name) : null;
    // Non-wine rows group on the exact name plus a counter, so two items
    // that happen to share a name stay two rows.
    const groups = sections.get(category) ?? new Map();
    sections.set(category, groups);
    let key = parts ? `w:${foldText(parts.wineName)}` : `i:${foldText(name)}`;
    if (!parts) {
      let n = 1;
      while (groups.has(key)) key = `i:${foldText(name)}#${n++}`;
    }
    const group = groups.get(key) ?? { name: parts ? parts.wineName : name, wine, members: [] };
    group.members.push({ row, parts });
    groups.set(key, group);
  }

  return Array.from(sections.entries())
    .sort(([a], [b]) => compareCountCategories(a, b))
    .map(([category, groups]) => {
      const ordered = Array.from(groups.entries())
        .map(([key, group]) => {
          const members = group.members.slice().sort((a, b) => {
            if (!a.parts || !b.parts) return 0;
            const byYear = vintageSortValue(a.parts) - vintageSortValue(b.parts);
            if (byYear !== 0) return byYear;
            return Number(a.parts.packSuffix) - Number(b.parts.packSuffix);
          });
          const labels = members.map((member) => (member.parts ? vintageLabelFor(member.parts) : null));
          const entries = members.map((member, index) => {
            const label = labels[index] ?? null;
            const clash = label !== null && labels.filter((other) => other === label).length > 1;
            let detail: string | null = null;
            if (clash && member.parts) {
              const name = get.name(member.row).trim();
              const pack = name.match(PACK_SUFFIX);
              detail = pack ? pack[0].replace(/^[\s-]*\(|\)\s*$/g, '').trim() : name;
            }
            return { row: member.row, vintageLabel: label, detail };
          });
          // Head a wine group with the floor's spelling (no pack suffix) when
          // there is one; the invoice import's names are the noisier ones.
          const heading = members.find((member) => member.parts && !member.parts.packSuffix) ?? members[0];
          const name = heading?.parts?.wineName ?? group.name;
          return { key, name, wine: group.wine, entries };
        })
        .sort((a, b) => a.key.slice(2).localeCompare(b.key.slice(2), 'en') || a.key.localeCompare(b.key));
      return { category, groups: ordered, rowCount: ordered.reduce((sum, group) => sum + group.entries.length, 0) };
    });
}

/** Flatten organised sections back to rows, in walk order. */
export function countRowsInWalkOrder<T>(sections: Array<CountSection<T>>): T[] {
  return sections.flatMap((section) => section.groups.flatMap((group) => group.entries.map((entry) => entry.row)));
}

/**
 * A matcher for the count screen's search box. Every word typed must appear
 * in the text, in any order — partial words count ("tequ", "202").
 * An empty query matches everything.
 */
export function countSearchMatcher(query: string): (text: string) => boolean {
  const tokens = foldText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return () => true;
  return (text: string) => {
    const haystack = foldText(text);
    return tokens.every((token) => haystack.includes(token));
  };
}
