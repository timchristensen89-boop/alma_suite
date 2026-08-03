/**
 * Catching a count that was made in the wrong unit.
 *
 * Found by walking the Stock app against production data: of 4,456 counted
 * stocktake lines, **eight** carry $3.71M of the $4.86M total counted value —
 * 76% of everything the venues believe they hold. They are not wealth, they
 * are unit mistakes:
 *
 *   Manly Spirits Dry Gin      21,725 "bottles"  @ $54.71  = $1,188,592
 *   Manly Spirits Triple Sec   15,900 "bottles"  @ $38.75  =   $616,125
 *   Callebaut White Callet      1,096 "each"     @ $109.34 =   $119,797
 *   Wedge Cerveza Keg             217 "kegs"     @ $270.00 =    $58,563
 *
 * Somebody counted millilitres and the app recorded bottles. Nothing noticed:
 * the stocktake applied, the value went into stock on hand, a par level was
 * derived from it, and the reorder engine then proposed ordering 21,724 more
 * bottles of gin — a $2.17M suggested order that no manager would ever act on,
 * which is why the purchase-order screen has never been used once in
 * production.
 *
 * The existing item health check looks for missing and stale costs. It cannot
 * see this, because every field involved is individually valid: the quantity
 * is a number, the cost is a real cost, the unit is a real unit. Only the
 * product of them is absurd.
 *
 * The rule here is deliberately self-calibrating. No threshold in dollars
 * would survive a venue twice the size; a share of what was actually counted
 * does. In this data the separation is enormous: the largest plausible line is
 * $2,310 (the 99th percentile), the smallest implausible one is $14,040, and
 * everything above that is a unit mistake.
 */

export type CountedLine = {
  itemId: string;
  itemName: string;
  venue: string | null;
  countedQty: number;
  /** Cost per count unit, in cents. */
  unitCostCents: number | null;
  countUnit: string | null;
  /** How much of `measureUnit` one count unit holds — 750 for a 750ml bottle. */
  measurePerCountUnit?: number | null;
  measureUnit?: string | null;
};

export type ImplausibleCount = CountedLine & {
  lineValueCents: number;
  /** This line's share of everything counted, 0–1. */
  shareOfCounted: number;
  /**
   * What the number would mean if it had been keyed in the item's measure
   * unit instead of its count unit. Null when the item carries no measure.
   */
  ifMeasuredInstead: { quantity: number; unit: string } | null;
  message: string;
};

/**
 * A single line worth more than this share of everything counted is not a
 * count, it is a units mistake.
 *
 * 2% against the real data flags the eight bad lines and nothing else — the
 * biggest legitimate line sits at 0.05% of the total. The margin is roughly
 * forty-fold in both directions, so this is not a number that needs tuning.
 */
export const IMPLAUSIBLE_COUNT_SHARE = 0.02;

/**
 * A line has to be worth something before a share is meaningful.
 *
 * Without this, a venue whose only counted line is a $12 bottle of vinegar
 * would see it flagged for being 100% of the count.
 */
export const IMPLAUSIBLE_COUNT_FLOOR_CENTS = 500_00;

function round(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Find counted lines that cannot be what their unit says they are.
 *
 * Pass every counted line for the period being judged; the share is computed
 * across the set, so a partial set gives a partial answer.
 */
export function implausibleCountLines(
  lines: CountedLine[],
  options: { share?: number; floorCents?: number } = {}
): ImplausibleCount[] {
  const share = options.share ?? IMPLAUSIBLE_COUNT_SHARE;
  const floorCents = options.floorCents ?? IMPLAUSIBLE_COUNT_FLOOR_CENTS;

  const valued = lines.map((line) => ({
    line,
    cents: Math.round((line.countedQty || 0) * (line.unitCostCents ?? 0))
  }));
  const total = valued.reduce((sum, entry) => sum + Math.max(0, entry.cents), 0);
  if (total <= 0) return [];

  const flagged: ImplausibleCount[] = [];
  for (const { line, cents } of valued) {
    if (cents < floorCents) continue;
    const lineShare = cents / total;
    if (lineShare < share) continue;

    // If the item knows how much its count unit holds, the same number read as
    // that measure is usually the count somebody meant.
    const per = line.measurePerCountUnit ?? null;
    const ifMeasuredInstead =
      per && per > 0 && line.measureUnit
        ? { quantity: round(line.countedQty / per, 2), unit: line.countUnit ?? 'unit' }
        : null;

    const where = line.venue ? ` at ${line.venue}` : '';
    const guess = ifMeasuredInstead
      ? ` If that was ${line.measureUnit}, the count is about ${ifMeasuredInstead.quantity} ${ifMeasuredInstead.unit}.`
      : '';

    flagged.push({
      ...line,
      lineValueCents: cents,
      shareOfCounted: round(lineShare, 4),
      ifMeasuredInstead,
      message:
        `${line.countedQty.toLocaleString('en-AU')} ${line.countUnit ?? 'units'}${where} comes to ` +
        `${money(cents)} — ${Math.round(lineShare * 100)}% of everything counted. ` +
        `That reads like a count in ${line.measureUnit ?? 'a different unit'} recorded as ` +
        `${line.countUnit ?? 'count units'}.${guess}`
    });
  }

  return flagged.sort((a, b) => b.lineValueCents - a.lineValueCents);
}

/**
 * Total value of counted lines, excluding the ones that are unit mistakes.
 *
 * The number a manager should be shown alongside the raw total, because the
 * raw total in this venue is 76% fiction.
 */
export function countedValueExcludingImplausible(
  lines: CountedLine[],
  options: { share?: number; floorCents?: number } = {}
): { totalCents: number; trustedCents: number; excludedCents: number; excludedLines: number } {
  const flagged = new Set(implausibleCountLines(lines, options).map((line) => line.itemId + '|' + (line.venue ?? '')));
  let totalCents = 0;
  let excludedCents = 0;
  let excludedLines = 0;
  for (const line of lines) {
    const cents = Math.round((line.countedQty || 0) * (line.unitCostCents ?? 0));
    totalCents += cents;
    if (flagged.has(line.itemId + '|' + (line.venue ?? ''))) {
      excludedCents += cents;
      excludedLines += 1;
    }
  }
  return { totalCents, trustedCents: totalCents - excludedCents, excludedCents, excludedLines };
}
