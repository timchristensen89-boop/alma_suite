/**
 * Duplicate stock item detection.
 *
 * The catalogue was imported from three systems (the legacy Firestore app,
 * Loaded, and hand entry) and the same product exists several times under
 * slightly different spellings: "Corona 355ml" and "Corona 355ml (case of 24)",
 * "Lime" and "Limes", "Don Julio Blanco 750ml" and "Don Julio Blanco 750ML".
 * Every duplicate splits the on-hand, the purchase history and the recipe
 * links across two rows, so the count sheet lists the same shelf twice and the
 * variance report can never reconcile either half.
 *
 * This module is the one place that decides what "looks like the same item".
 * It is pure so the rule can be unit tested and shared by the API (server-side
 * report) and any client that wants to flag a likely duplicate at entry time.
 *
 * Rules, carried over from the manager-run merge script that predates this:
 *  - Wine, spirits, liqueurs and aperitifs match on the EXACT normalised name
 *    only. A 2022 and a 2023 vintage, or a 700 ml and a 1 L bottling, are
 *    different products.
 *  - Everything else matches on a "core" name: lowercased, pack words and
 *    parenthesised pack notes removed, size tokens removed, trailing plural
 *    "s" folded.
 *  - A group whose members carry DIFFERENT explicit sizes (1kg vs 12.5kg) is
 *    reported but flagged `sizeConflict` so nobody merges two pack sizes by
 *    accident. It is still shown: a manager may know they really are one.
 *  - A group whose members use different purchase units is flagged
 *    `unitConflict` for the same reason.
 */

export type DuplicateCandidate = {
  id: string;
  name: string;
  sku?: string | null;
  unit: string;
  countUnit?: string | null;
  categoryName?: string | null;
  status?: 'ACTIVE' | 'ARCHIVED';
};

export type DuplicateMatchBasis = 'exact' | 'core';

export type DuplicateGroup<T extends DuplicateCandidate = DuplicateCandidate> = {
  /** Stable grouping key — safe to use as a React key. */
  key: string;
  basis: DuplicateMatchBasis;
  /** Members carry different explicit sizes ("1kg" vs "12.5kg"). */
  sizeConflict: boolean;
  /** Members are bought in different units ("case" vs "bottle"). */
  unitConflict: boolean;
  items: T[];
};

const SIZE_RE = /\b\d+(?:\.\d+)?\s?(?:kg|g|gm|gram|grams?|ml|l|lt|ltr|litres?|liters?|cl|oz|inch|cm|mm)\b/gi;
const PACK_WORD_RE = /\b(?:ea|each|pk|pack|pkt|ctn|carton|case|cases|box|boxes|tray|bag|bags|tin|tins|jar|jars|bottle|bottles|btl|can|cans|unit|units|x)\b/gi;
const PRECISE_CATEGORY_RE = /wine|spirit|liqueur|aperitif|champagne|sparkling/i;

export function normaliseStockItemName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * The product with pack and size noise removed. "Corona 355ml (case of 24)"
 * and "Corona 355ML" both become "corona".
 */
export function coreStockItemName(name: string): string {
  let n = name.toLowerCase();
  n = n.replace(/\(case of \d+\)/g, ' ');
  n = n.replace(/\bea\s*\(\d+\)/g, ' ');
  n = n.replace(/\([^)]*\)/g, ' ');
  n = n.replace(SIZE_RE, ' ');
  n = n.replace(/\b\d+\s*x\s*\d+\b/g, ' ');
  n = n.replace(PACK_WORD_RE, ' ');
  n = n.replace(/[^a-z0-9 ]/g, ' ');
  const tokens = n
    .split(/\s+/)
    .filter(Boolean)
    .map(singular);
  return tokens.join(' ').trim();
}

// Fold a trailing plural "s" so "Limes" and "Lime" meet. Words that end in
// "ss", "sses", "us" or "is" are not plurals (glass, molasses, hummus, basis).
function singular(token: string): string {
  if (token.length <= 3 || !token.endsWith('s')) return token;
  if (/(?:ss|sses|us|is)$/.test(token)) return token;
  return token.slice(0, -1);
}

export function stockItemSizeTokens(name: string): string[] {
  return (name.toLowerCase().match(SIZE_RE) ?? []).map((token) => token.replace(/\s+/g, ''));
}

export function isPreciseMatchCategory(categoryName: string | null | undefined): boolean {
  return PRECISE_CATEGORY_RE.test(categoryName ?? '');
}

/** The key two items must share to be reported as duplicates of each other. */
export function duplicateGroupKey(item: Pick<DuplicateCandidate, 'name' | 'categoryName'>): {
  key: string;
  basis: DuplicateMatchBasis;
} | null {
  if (isPreciseMatchCategory(item.categoryName)) {
    const exact = normaliseStockItemName(item.name);
    return exact ? { key: `exact:${exact}`, basis: 'exact' } : null;
  }
  const core = coreStockItemName(item.name);
  return core ? { key: `core:${core}`, basis: 'core' } : null;
}

export function findDuplicateGroups<T extends DuplicateCandidate>(items: T[]): DuplicateGroup<T>[] {
  const groups = new Map<string, { basis: DuplicateMatchBasis; items: T[] }>();
  for (const item of items) {
    if (item.status && item.status !== 'ACTIVE') continue;
    const keyed = duplicateGroupKey(item);
    if (!keyed) continue;
    const group = groups.get(keyed.key) ?? { basis: keyed.basis, items: [] };
    group.items.push(item);
    groups.set(keyed.key, group);
  }
  const result: DuplicateGroup<T>[] = [];
  for (const [key, group] of groups) {
    if (group.items.length < 2) continue;
    const sizes = new Set(group.items.flatMap((item) => stockItemSizeTokens(item.name)));
    const units = new Set(group.items.map((item) => item.unit.trim().toLowerCase()).filter(Boolean));
    result.push({
      key,
      basis: group.basis,
      sizeConflict: sizes.size > 1,
      unitConflict: units.size > 1,
      items: [...group.items].sort((a, b) => a.name.localeCompare(b.name))
    });
  }
  // Clean matches first, then the flagged ones, alphabetical within each.
  return result.sort(
    (a, b) =>
      Number(a.sizeConflict || a.unitConflict) - Number(b.sizeConflict || b.unitConflict) ||
      a.items[0]!.name.localeCompare(b.items[0]!.name)
  );
}
