// Sharing a set menu's revenue across the dishes it bought. Pure so the
// banquet report and its tests apply the SAME rule. Covered by
// banquet-allocation.test.ts.
//
// A banquet sells for one price and its dishes ring at $0, so no dish has a
// price of its own to report on. To answer "which dish is making us money",
// each table's package revenue is shared across the dishes that table was
// actually served, in proportion to what those dishes fetch a la carte: the
// market fish carries more of the $99 than the orzo does, because that is what
// the two are worth on their own.
//
// Every cent is allocated. Largest-remainder rounding hands out the leftover
// cents to the lines with the biggest fractions, so the shares are whole cents
// AND they add back up to exactly what the table paid — a report whose parts
// do not sum to its total is a report nobody trusts twice.

export type AllocatableLine = {
  quantity: number;
  /** Menu price of one serve. Null/0 = never priced on its own. */
  alaCarteCents: number | null;
};

export function allocatePackageRevenue(packageRevenueCents: number, lines: AllocatableLine[]): number[] {
  if (lines.length === 0) return [];
  if (packageRevenueCents === 0) return lines.map(() => 0);

  const byValue = lines.map((line) => Math.max(0, (line.alaCarteCents ?? 0) * line.quantity));
  const valueTotal = byValue.reduce((sum, weight) => sum + weight, 0);
  // Nothing on the table is priced: fall back to an even split per serving, so
  // the revenue still lands somewhere truthful rather than nowhere at all.
  const weights = valueTotal > 0 ? byValue : lines.map((line) => Math.max(0, line.quantity));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  // No servings either (a package with nothing under it): the caller has
  // nothing to attribute to, and inventing a split would be worse than none.
  if (total <= 0) return lines.map(() => 0);

  const exact = weights.map((weight) => (packageRevenueCents * weight) / total);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = packageRevenueCents - floors.reduce((sum, value) => sum + value, 0);
  // Biggest fractional part first; ties go to the earlier line so the same
  // input always produces the same output.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  const shares = [...floors];
  for (const { index } of order) {
    if (remainder <= 0) break;
    shares[index] = (shares[index] ?? 0) + 1;
    remainder -= 1;
  }
  return shares;
}
