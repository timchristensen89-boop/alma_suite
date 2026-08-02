/**
 * Matching a supplier invoice line to a stock item.
 *
 * This is the join that makes costing real: an item's cost only updates from
 * a line that found its item, and item cost drives recipe cost, dish margin,
 * COGS and the value of the stock on the shelf. In production 71% of lines
 * never matched, so most of the catalogue was costing off stale prices.
 *
 * Pure, so the rules can be tested against real supplier text without a
 * database, and so the API and any review screen agree on what a match is.
 */

/* ------------------------------------------------------------------ */
/* Lines that are not stock at all                                     */
/* ------------------------------------------------------------------ */

/**
 * Charges, fees and header rows. These are real invoice lines and belong on
 * the invoice, but they are not a product and will never match an item.
 *
 * Left in the review queue they are pure noise — in production these were 256
 * of 995 lines waiting for review (Square Fees alone appeared 140 times), so
 * a quarter of the work the queue asked for could never be completed.
 */
const NON_STOCK_PATTERNS: RegExp[] = [
  /^(delivery|freight|shipping|cartage)( (fee|charge|cost))?$/,
  /^(square |stripe |merchant |card |payment |processing |transaction )?fees?$/,
  /^(service|admin|administration|handling|fuel|surcharge|late)( (fee|charge))?$/,
  /^(credit|adjustment|rounding|discount|rebate rebate|rebate)$/,
  /^(gst|tax|vat)( (on|amount))?$/,
  /^(subtotal|total|balance|amount due|opening balance)$/,
  /^(food supplies|beverage supplies|sundries|misc|miscellaneous|general)$/,
  /^(deposit|bond|container deposit|keg deposit)$/
];

/**
 * Is this line a charge rather than a product?
 *
 * `supplierName` is passed because some invoices repeat the supplier's own
 * name as a section header line — "Paramount Liquor" appeared 15 times as a
 * line on Paramount Liquor invoices.
 */
export function isNonStockLine(description: string, supplierName?: string | null): boolean {
  const text = description.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return true;
  if (NON_STOCK_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (supplierName && text === supplierName.trim().toLowerCase().replace(/\s+/g, ' ')) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Reading a supplier's product description                            */
/* ------------------------------------------------------------------ */

/**
 * Words that appear in nearly every supplier description and so carry no
 * information about WHICH item this is. Matching on these produces confident
 * nonsense — "FRESH" would tie a snapper fillet to fresh cream.
 */
const NOISE_TOKENS = new Set([
  'ea', 'ctn', 'pkt', 'pk', 'bx', 'box', 'bag', 'btl', 'bottle', 'case', 'each',
  'kg', 'g', 'gm', 'gms', 'ml', 'lt', 'ltr', 'l', 'mm', 'cm', 'pc', 'pcs', 'piece', 'pieces',
  'x', 'of', 'the', 'and', 'with', 'per', 'approx', 'fresh', 'frozen', 'chilled',
  'ordered', 'supplied', 'qty', 'unit', 'units', 'sleeve', 'pack', 'packet'
]);

/**
 * Strip a supplier catalogue string back to the words that identify the
 * product.
 *
 * Real examples this has to survive:
 *   "CHIPS 7MM SHOESTRING FRIES 5X3KG G/FREE (McCain) CTN. Ordered: 1 unit, Supplied Qty: 1 unit"
 *   "TOILET PAPER ROLL 2PLY 400SHT IND WRAP 48'S (Pure Washroom)"
 *   "COCONUT MILK 400ML (Royal Line) EA (24)"
 */
export function productTokens(description: string): string[] {
  let text = description.toLowerCase();
  // Trailing order/supply commentary the supplier appends after the product.
  text = text.replace(/\.\s*ordered:.*$/, '');
  text = text.replace(/,?\s*supplied qty:.*$/, '');
  // Bracketed brand or pack-count suffixes: "(McCain)", "(24)".
  text = text.replace(/\([^)]*\)/g, ' ');
  // Pack sizes and measures: 5x3kg, 400ml, 48's, 2ply, 400sht, 7mm.
  text = text.replace(/\b\d+(\.\d+)?\s*x\s*\d+(\.\d+)?\s*[a-z]*\b/g, ' ');
  text = text.replace(/\b\d+(\.\d+)?\s*(kg|g|gm|gms|ml|lt|ltr|l|mm|cm|sht|ply|s)\b/g, ' ');
  text = text.replace(/\b\d+'s\b/g, ' ');
  // Anything left that is purely numeric carries no product identity.
  text = text.replace(/[^a-z0-9]+/g, ' ');

  return text
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !/^\d+$/.test(token) && !NOISE_TOKENS.has(token));
}

/* ------------------------------------------------------------------ */
/* Words that mean two products are NOT the same thing                 */
/* ------------------------------------------------------------------ */

/**
 * Groups of mutually exclusive qualifiers. Two names that disagree inside a
 * group describe different products however much else they share.
 *
 * This exists because of a real near-miss: "CHICKEN THIGH FILLETS SKIN ON"
 * scored 0.8 against the item "CHICKEN THIGH FILLETS SKIN OFF" — four of five
 * words identical, and the one word that mattered was the one that differed.
 * On overlap alone that is a confident auto-match writing one product's price
 * onto another.
 */
const OPPOSING_TOKEN_GROUPS: string[][] = [
  ['on', 'off'],
  ['skin', 'skinless'],
  ['bone', 'boneless', 'bonein'],
  ['salted', 'unsalted'],
  ['sweetened', 'unsweetened'],
  ['seeded', 'seedless'],
  ['white', 'brown', 'red', 'green', 'black', 'yellow', 'pink'],
  ['whole', 'sliced', 'diced', 'shredded', 'minced', 'crushed', 'ground'],
  ['large', 'medium', 'small', 'jumbo', 'mini'],
  ['hot', 'mild', 'spicy'],
  ['full', 'light', 'skim', 'lite'],
  ['raw', 'cooked', 'smoked'],
  ['thick', 'thin'],
  ['still', 'sparkling']
];

/**
 * Do these two token sets disagree about something that matters?
 *
 * Only counts when BOTH sides state a value from the same group. An item that
 * simply says nothing about size is not contradicted by a description that
 * does — silence is not disagreement.
 */
export function contradicts(a: Set<string>, b: Set<string>): boolean {
  for (const group of OPPOSING_TOKEN_GROUPS) {
    const inA = group.filter((token) => a.has(token));
    const inB = group.filter((token) => b.has(token));
    if (inA.length === 0 || inB.length === 0) continue;
    if (!inA.some((token) => inB.includes(token))) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

export type MatchCandidate = { id: string; name: string; sku?: string | null };

export type InvoiceMatch = {
  itemId: string | null;
  status: 'AUTO_MATCHED' | 'NEEDS_REVIEW' | 'NON_STOCK';
  /** 0-1. How much of the item's own name the description accounted for. */
  confidence: number;
  reason: 'ALIAS' | 'SKU' | 'EXACT_NAME' | 'TOKENS' | 'NONE' | 'NON_STOCK';
};

/**
 * Auto-match only above this. Below it a human decides.
 *
 * Set by what it costs to be wrong: a false match silently writes the wrong
 * price onto an item and quietly corrupts every recipe using it, while a
 * missed match only leaves a line in a queue somebody can clear in a second.
 * The asymmetry says be conservative.
 */
export const AUTO_MATCH_THRESHOLD = 0.7;

function normaliseKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normaliseName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Match one invoice line.
 *
 * `aliases` maps a previously-confirmed description to an item id, so a match
 * a human made once is never asked for again. This matters more than any
 * scoring subtlety: in production the same description recurred up to 13
 * times, each one asking for the same decision.
 */
export function matchInvoiceLine(
  line: { description: string; itemCode?: string | null },
  items: MatchCandidate[],
  options: { supplierName?: string | null; aliases?: Map<string, string> } = {}
): InvoiceMatch {
  const description = line.description ?? '';

  if (isNonStockLine(description, options.supplierName)) {
    return { itemId: null, status: 'NON_STOCK', confidence: 1, reason: 'NON_STOCK' };
  }

  // A match somebody already confirmed for this exact text.
  const alias = options.aliases?.get(aliasKey(description));
  if (alias && items.some((item) => item.id === alias)) {
    return { itemId: alias, status: 'AUTO_MATCHED', confidence: 1, reason: 'ALIAS' };
  }

  const code = normaliseKey(line.itemCode ?? '');
  if (code) {
    const bySku = items.find((item) => item.sku && normaliseKey(item.sku) === code);
    if (bySku) return { itemId: bySku.id, status: 'AUTO_MATCHED', confidence: 1, reason: 'SKU' };
  }

  const flatDescription = normaliseName(description);
  const byName = items.find((item) => normaliseName(item.name) === flatDescription);
  if (byName) return { itemId: byName.id, status: 'AUTO_MATCHED', confidence: 1, reason: 'EXACT_NAME' };

  const lineTokens = new Set(productTokens(description));
  if (lineTokens.size === 0) {
    return { itemId: null, status: 'NEEDS_REVIEW', confidence: 0, reason: 'NONE' };
  }

  let best: { item: MatchCandidate; score: number } | null = null;
  let runnerUp = 0;
  for (const item of items) {
    const itemTokens = productTokens(item.name);
    if (itemTokens.length === 0) continue;
    // Skin on is not skin off, however many other words agree.
    if (contradicts(new Set(itemTokens), lineTokens)) continue;
    const hits = itemTokens.filter((token) => lineTokens.has(token)).length;
    if (hits === 0) continue;
    // Share of the ITEM's own words that the description accounted for. Scoring
    // the other way round would favour short descriptions over the right item.
    const score = hits / itemTokens.length;
    if (!best || score > best.score) {
      runnerUp = best?.score ?? 0;
      best = { item, score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  if (!best) return { itemId: null, status: 'NEEDS_REVIEW', confidence: 0, reason: 'NONE' };

  // Two items fitting equally well is not a match, it is a question. Auto-
  // matching the first would be a coin flip written into the cost of a recipe.
  const decisive = best.score - runnerUp >= 0.2 || runnerUp === 0;
  const confident = best.score >= AUTO_MATCH_THRESHOLD && decisive;

  return {
    itemId: confident ? best.item.id : null,
    status: confident ? 'AUTO_MATCHED' : 'NEEDS_REVIEW',
    confidence: Number(best.score.toFixed(2)),
    reason: confident ? 'TOKENS' : 'NONE'
  };
}

/**
 * Suggestions for a line a human has to decide, best first. The review screen
 * shows these so the common case is one tap rather than a search.
 */
export function suggestItems(
  description: string,
  items: MatchCandidate[],
  limit = 5
): Array<{ item: MatchCandidate; confidence: number }> {
  const lineTokens = new Set(productTokens(description));
  if (lineTokens.size === 0) return [];
  return items
    .map((item) => {
      const itemTokens = productTokens(item.name);
      if (itemTokens.length === 0) return { item, confidence: 0 };
      const hits = itemTokens.filter((token) => lineTokens.has(token)).length;
      const score = hits / itemTokens.length;
      // Still offered — a person can see that "skin off" is the near neighbour
      // of "skin on" and may want it — but never ranked as though it fits.
      const penalty = contradicts(new Set(itemTokens), lineTokens) ? 0.5 : 1;
      return { item, confidence: Number((score * penalty).toFixed(2)) };
    })
    .filter((row) => row.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

/** The key an alias is remembered under. */
export function aliasKey(description: string): string {
  return normaliseName(description);
}
