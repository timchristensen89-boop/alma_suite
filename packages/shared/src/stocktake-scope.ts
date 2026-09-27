// What a stocktake counted, and whether its value can be trusted to bound a
// period's cost of goods.
//
// Alma counts the kitchen and the bar as SEPARATE sheets ("St Alma — Kitchen",
// "St Alma — Bar & FOH"), on different days, sometimes weeks apart. Supplier
// purchases are one combined stream (food and beverage invoices are not told
// apart locally). So a food-only count used as a period's opening stock, set
// against combined purchases, produces a precise-looking number that measures
// nothing: Alma Avalon's June COGS of $12,194.52 (18.9%) came from exactly
// that mismatch. Correct arithmetic over mismatched populations is still wrong.
//
// Two facts about every count are therefore first-class:
//
//   • scope — FOOD, BEVERAGE, COMBINED or UNKNOWN. Never inferred from the
//     dollar value (a $2,000 count is not "food" because it is small). Set
//     prospectively from evidence — the template a count was started from,
//     the category headings of a Loaded sheet — and defaulted to UNKNOWN for
//     everything historical or ambiguous. An UNKNOWN count cannot bound COGS.
//   • valuation completeness — a count whose counted lines carry no value is
//     understated by an unknown amount. Such a count can still print a
//     plausible total. It cannot bound COGS either, and says why.

export const STOCKTAKE_SCOPES = ['FOOD', 'BEVERAGE', 'COMBINED', 'UNKNOWN'] as const;
export type StocktakeScope = (typeof STOCKTAKE_SCOPES)[number];

/** Boundary window: a count within this many days either side of a period boundary may bound it. */
export const STOCKTAKE_BOUNDARY_WINDOW_DAYS = 7;

/** FOOD and BEVERAGE components further apart than this compose with an explicit quality warning. */
export const STOCKTAKE_COMPONENT_GAP_WARNING_DAYS = 3;

export type StockHeadingClass = 'food' | 'beverage' | null;

// Category / heading words that place a group of lines on one side of the
// kitchen–bar divide. Whole-word, case-insensitive, and only the words that
// have actually appeared as Alma stock categories or Loaded sheet headings.
// A heading that matches neither list, or both, is unclassified — and one
// unclassified heading makes the whole sheet UNKNOWN, never a guess.
const BEVERAGE_WORDS = [
  'spirit', 'spirits', 'wine', 'wines', 'beer', 'beers', 'cider', 'ciders', 'liqueur', 'liqueurs', 'aperitif', 'aperitifs',
  'mixer', 'mixers', 'non-alcoholic', 'alcohol', 'bottled', 'draught', 'tap', 'keg', 'kegs', 'vodka', 'gin', 'rum', 'whisky',
  'whiskey', 'tequila', 'mezcal', 'champagne', 'sparkling', 'rosé', 'rose', 'cocktail', 'cocktails', 'soft', 'juice', 'juices',
  'bar', 'foh', 'beverage', 'beverages', 'drinks', 'drink'
];
const FOOD_WORDS = [
  'dairy', 'egg', 'eggs', 'dry', 'pantry', 'goods', 'meat', 'meats', 'poultry', 'produce', 'seafood', 'fish', 'bakery',
  'bread', 'dessert', 'desserts', 'sweets', 'frozen', 'herb', 'herbs', 'spice', 'spices', 'oil', 'oils', 'condiment',
  'condiments', 'sauce', 'sauces', 'grocery', 'groceries', 'vegetable', 'vegetables', 'veg', 'fruit', 'fruits', 'cheese',
  'butter', 'kitchen', 'food', 'prep', 'protein', 'proteins', 'freezer'
];

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-zà-ÿ-]+/u)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);

/** food / beverage / null for a stock category name or a Loaded sheet heading. */
export function classifyStockHeading(heading: string | null | undefined): StockHeadingClass {
  if (!heading) return null;
  const tokens = words(heading);
  const bev = tokens.some((t) => BEVERAGE_WORDS.includes(t));
  const food = tokens.some((t) => FOOD_WORDS.includes(t));
  if (bev && !food) return 'beverage';
  if (food && !bev) return 'food';
  return null;
}

export type ScopeDerivation = { scope: StocktakeScope; evidence: string };

/**
 * A sheet whose headings are ENTIRELY food is FOOD; entirely beverage is
 * BEVERAGE. Anything mixed or unclassifiable is UNKNOWN — a mixed sheet is
 * not COMBINED, because "combined" means the venue's whole holding, and a
 * sheet with a food heading and a beverage heading is not evidence of that.
 */
export function scopeFromHeadings(headings: Iterable<string | null | undefined>, source: string): ScopeDerivation {
  const distinct = [...new Set([...headings].map((h) => (h ?? '').trim()).filter((h) => h.length > 0))];
  if (distinct.length === 0) return { scope: 'UNKNOWN', evidence: `${source}: no headings` };
  const classes = distinct.map((h) => ({ heading: h, cls: classifyStockHeading(h) }));
  const unclassified = classes.filter((c) => c.cls === null).map((c) => c.heading);
  if (unclassified.length > 0) {
    return { scope: 'UNKNOWN', evidence: `${source}: unclassified heading${unclassified.length === 1 ? '' : 's'} ${unclassified.map((h) => `"${h}"`).join(', ')}` };
  }
  const kinds = new Set(classes.map((c) => c.cls));
  if (kinds.size === 1 && kinds.has('food')) return { scope: 'FOOD', evidence: `${source}: all ${distinct.length} headings are food` };
  if (kinds.size === 1 && kinds.has('beverage')) return { scope: 'BEVERAGE', evidence: `${source}: all ${distinct.length} headings are beverage` };
  return { scope: 'UNKNOWN', evidence: `${source}: headings mix food and beverage` };
}

/**
 * The scope a template's NAME supports: "Kitchen" → FOOD, "Bar & FOH" /
 * "Bar" / "Drinks" → BEVERAGE. A name never supports COMBINED — a "Full
 * count" template is only combined if its categories say so (scopeFromHeadings
 * over the template's categories), and nothing here claims it.
 */
export function scopeFromTemplateName(name: string | null | undefined): ScopeDerivation {
  const text = (name ?? '').trim();
  if (!text) return { scope: 'UNKNOWN', evidence: 'no template' };
  const cls = classifyStockHeading(text);
  if (cls === 'food') return { scope: 'FOOD', evidence: `template name "${text}"` };
  if (cls === 'beverage') return { scope: 'BEVERAGE', evidence: `template name "${text}"` };
  return { scope: 'UNKNOWN', evidence: `template name "${text}" does not say what was counted` };
}

/**
 * A count started from a template: the template's categories are the best
 * evidence (they are what was on the sheet); the name is the fallback.
 */
export function scopeForTemplate(template: { name: string | null | undefined; categoryNames?: string[] }): ScopeDerivation {
  const names = template.categoryNames ?? [];
  if (names.length > 0) {
    const fromCategories = scopeFromHeadings(names, `template "${template.name ?? ''}" categories`);
    if (fromCategories.scope !== 'UNKNOWN') return fromCategories;
  }
  return scopeFromTemplateName(template.name);
}

// ── Valuation completeness ──────────────────────────────────────────────────

export type StocktakeLineValuationInput = {
  itemId?: string | null;
  recipeId?: string | null;
  countedQty: number | null | undefined;
  stockValueCents: number | null | undefined;
};

export type StocktakeValuation = {
  /** Every line on the count. */
  lines: number;
  /** Lines with a counted quantity (null = never counted, excluded from the judgement). */
  counted: number;
  /** Counted at zero: legitimately worth nothing. */
  zero: number;
  /** Counted above zero, linked to an item or a prep recipe, and valued. */
  linkedValued: number;
  /** Counted above zero, linked to nothing, but carrying an explicit value (a Loaded valuation). */
  unlinkedValued: number;
  /** Counted above zero with NO value — linked or not. The count is understated by an unknown amount. */
  unvalued: number;
  /** Σ stockValueCents over the lines. */
  valueCents: number;
  /** 0–1 share of positively-counted lines that carry a value; null when nothing was counted above zero. */
  valuedShare: number | null;
  /** True only when no positively-counted line is unvalued and at least one line was counted. */
  sufficient: boolean;
  /** Why not, in operator words; null when sufficient. */
  reason: string | null;
};

/**
 * The rule: a count bounds COGS only when every line counted above zero
 * carries a value. There is no percentage threshold, deliberately — the
 * share of LINES says nothing about the share of DOLLARS (one unvalued line
 * can be the keg room), so any cut-off would let a materially incomplete
 * count through on a plausible total. A count with unvalued lines is
 * refused and says how many, which is also exactly the list to fix.
 */
export function assessStocktakeValuation(lines: StocktakeLineValuationInput[]): StocktakeValuation {
  let counted = 0;
  let zero = 0;
  let linkedValued = 0;
  let unlinkedValued = 0;
  let unvalued = 0;
  let valueCents = 0;
  for (const line of lines) {
    valueCents += line.stockValueCents ?? 0;
    if (line.countedQty == null) continue;
    counted += 1;
    if (line.countedQty === 0) {
      zero += 1;
      continue;
    }
    const linked = Boolean(line.itemId || line.recipeId);
    if (line.stockValueCents == null) unvalued += 1;
    else if (linked) linkedValued += 1;
    else unlinkedValued += 1;
  }
  const positive = counted - zero;
  const valuedShare = positive > 0 ? Math.round(((positive - unvalued) / positive) * 1000) / 1000 : null;
  let reason: string | null = null;
  if (lines.length === 0) reason = 'The count has no lines.';
  else if (counted === 0) reason = 'Nothing on the count was counted.';
  else if (unvalued > 0) reason = `${unvalued} of ${positive} counted line${positive === 1 ? '' : 's'} carr${unvalued === 1 ? 'ies' : 'y'} no value, so the count is understated by an unknown amount.`;
  return {
    lines: lines.length,
    counted,
    zero,
    linkedValued,
    unlinkedValued,
    unvalued,
    valueCents,
    valuedShare,
    sufficient: reason === null,
    reason
  };
}
