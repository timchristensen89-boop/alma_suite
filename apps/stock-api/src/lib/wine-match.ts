/**
 * Matching a printed wine list against the register's items — pure, so the
 * rules that decide whether two names are the same wine can be tested rather
 * than trusted. Covered by wine-match.test.ts.
 *
 * The two sides describe the same bottle at different lengths, and which side
 * is longer varies: the register writes "Producer Grape Size" while the list
 * writes producer, cuvée, and the blend spelled out. So this is deliberately
 * NOT a symmetric similarity.
 */

/**
 * Words that carry no signal either way: pour sizes, vintages, and articles.
 *
 * Kept deliberately short. An earlier version also dropped "domaine",
 * "chateau", "estate", "reserve" and the like as boilerplate — which threw
 * away the very words that tell Domaines Schlumberger from Domaine Bouchard,
 * and left Gilbert Family Wines with one token out of three.
 */
const NOISE = new Set(['ml', 'mls', 'bottle', 'btl', 'glass', 'nv', 'the', 'and', 'de', 'du', 'di', 'da', 'la', 'le', 'el']);

/**
 * Accents are the single biggest source of near-misses: the printed list sets
 * Château Domecq and Taittinger Brut Réserve, the register has them plain.
 * Folding diacritics away makes those exact rather than 0.25.
 */
export function tokens(text: string): Set<string> {
  return new Set(
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\b\d{2,4}\s*ml\b/g, ' ')
      .replace(/\b(19|20)\d{2}\b/g, ' ')
      .replace(/[''`"]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((word) => word.length > 1 && !NOISE.has(word))
  );
}

export function shared(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const token of a) if (b.has(token)) n += 1;
  return n;
}

/**
 * How well a menu row explains a register title.
 *
 * What matters is that every word in the register title is accounted for by the
 * wine (precision), weighted by how much of the producer's name the register
 * kept (coverage) so a fuller name beats a one-word coincidence.
 *
 * `wanted` should carry the producer, cuvée and grape AND the style words the
 * register tends to append — "Rose", "Sparkling". Without those, "R. Paulazzo"
 * against "R. Paulazzo Rose 150mL" scores 0.5 and is reported as missing,
 * purely for a word the list keeps in a column instead of in the name.
 */
export function explains(wanted: Set<string>, maker: Set<string>, recipe: Set<string>): number {
  if (recipe.size === 0 || maker.size === 0) return 0;
  const precision = shared(wanted, recipe) / recipe.size;
  const coverage = shared(maker, recipe) / maker.size;
  return precision * (0.5 + 0.5 * coverage);
}

/** "BenMarco Malbec 150mL" -> 150. Absent means the whole bottle. */
export function poursizeOf(title: string): number {
  const match = title.match(/(\d{2,4})\s*ml\b/i);
  return match ? Number(match[1]) : 750;
}

/**
 * The vintage a register title states, if it states one.
 *
 * Only a year that stands alone counts: "Rockford Basket Press Shiraz 2017
 * 750mL" is a 2017, but "Surco 2.7" and "Magnolia 1941" (a vineyard planting,
 * not a vintage) are not — and 1941 would otherwise beat a real year.
 */
export function vintageOf(title: string): number | null {
  const matches = title.match(/(?:^|\s)(19[5-9]\d|20[0-4]\d)(?=\s|$)/g);
  if (!matches || matches.length !== 1) return null;
  return Number(matches[0].trim());
}

/**
 * Does a register title's stated vintage rule this row in or out?
 *
 *   'agree'    — both name a year and it is the same one
 *   'disagree' — both name a year and they differ
 *   'silent'   — at least one side does not say
 *
 * The register carries two Rockford Basket Press bottles, 2017 and 2018, and
 * the list carries both. Every word except the year is identical, so without
 * this they score 1.00 against each other and both are dropped as ambiguous.
 */
export function vintageVerdict(rowVintage: number | null, title: string): 'agree' | 'disagree' | 'silent' {
  const stated = vintageOf(title);
  if (rowVintage === null || stated === null) return 'silent';
  return rowVintage === stated ? 'agree' : 'disagree';
}

/**
 * The score for one candidate, vintage taken into account.
 *
 * A stated vintage that disagrees is fatal rather than merely costly: two
 * bottles of the same wine from different years are different wines, and
 * putting a 2018's tasting note on a 2017 is exactly the kind of quiet wrong
 * a somm would notice and staff would not.
 */
export function scoreCandidate(input: {
  wanted: Set<string>;
  maker: Set<string>;
  title: string;
  recipeTokens: Set<string>;
  rowVintage: number | null;
}): number {
  const verdict = vintageVerdict(input.rowVintage, input.title);
  if (verdict === 'disagree') return 0;
  // The maker gate: the grape alone is shared by dozens of wines, so a match
  // has to share a word of the producer or cuvée before anything else counts.
  if (shared(input.maker, input.recipeTokens) === 0) return 0;
  const base = explains(input.wanted, input.maker, input.recipeTokens);
  // A confirmed vintage is real evidence, not a tiebreak — but it can only
  // lift a match that already stands on its name.
  return verdict === 'agree' ? Math.min(1, base * 1.15) : base;
}
