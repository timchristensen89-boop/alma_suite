/**
 * Reconciling the unit a Loaded count was made in with the unit Alma counts in.
 *
 * This is the root of the wrong-unit corruption, and it was never a human
 * error. Loaded and Alma simply disagree about four items, and every import
 * copied one system's number into the other's field:
 *
 *   Loaded:  Manly Spirits Dry Gin   mL      20,583.36   = $1,235.00
 *   Alma:    Manly Spirits Dry Gin   bottle  (750 ml per bottle, $54.71 each)
 *
 * Read as bottles, 20,583.36 is $1,126,115 of gin and a par level that asked
 * the venue to order 21,724 more. Read as what Loaded actually meant, it is
 * 27.4 bottles. Both systems were individually right the whole time.
 *
 * The distinction that makes this decidable is in the unit text itself:
 *
 *   "750 mL", "1 KG", "2 L", "12 Pack"   a pack size — the quantity counts packs
 *   "mL", "Kilo", "Litre", "kg"          a bare measure — the quantity IS that measure
 *   "Each", "Punnet", "Bunch", "Box"     a countable thing
 *
 * Only the middle case can be misread, and only when Alma counts that item in
 * something else. Alma already records how much measure sits in one count unit
 * (`measurePerCountUnit` + `measureUnit`), so the conversion is arithmetic with
 * both sides known — not a guess, and not a threshold.
 */

type Dimension = 'volume' | 'mass';

/** Everything normalises to millilitres or grams, the units Alma stores. */
const BASE: Record<string, { dimension: Dimension; perUnit: number }> = {
  ml: { dimension: 'volume', perUnit: 1 },
  millilitre: { dimension: 'volume', perUnit: 1 },
  millilitres: { dimension: 'volume', perUnit: 1 },
  l: { dimension: 'volume', perUnit: 1000 },
  ltr: { dimension: 'volume', perUnit: 1000 },
  litre: { dimension: 'volume', perUnit: 1000 },
  litres: { dimension: 'volume', perUnit: 1000 },
  liter: { dimension: 'volume', perUnit: 1000 },
  g: { dimension: 'mass', perUnit: 1 },
  gm: { dimension: 'mass', perUnit: 1 },
  gram: { dimension: 'mass', perUnit: 1 },
  grams: { dimension: 'mass', perUnit: 1 },
  kg: { dimension: 'mass', perUnit: 1000 },
  kilo: { dimension: 'mass', perUnit: 1000 },
  kilos: { dimension: 'mass', perUnit: 1000 },
  kilogram: { dimension: 'mass', perUnit: 1000 },
  kilograms: { dimension: 'mass', perUnit: 1000 }
};

/**
 * A unit that is purely a measure, with no pack size in front of it.
 *
 * "mL" qualifies and "750 mL" deliberately does not: the second means a
 * 750ml bottle, and its quantity is a number of bottles.
 */
export function bareMeasure(unit: string): { dimension: Dimension; perUnit: number; canonical: string } | null {
  const text = (unit ?? '').trim();
  if (!text || /\d/.test(text)) return null;
  const base = BASE[text.toLowerCase()];
  return base ? { ...base, canonical: text.toLowerCase() } : null;
}

export type CountUnitTarget = {
  /** What Alma counts this item in — "bottle", "kg", "each". */
  countUnit: string | null;
  /** How much measure one count unit holds — 750 for a 750ml bottle. */
  measurePerCountUnit: number | null;
  /** The unit `measurePerCountUnit` is expressed in: 'g' or 'ml'. */
  measureUnit: string | null;
};

export type UnitReconciliation = {
  /** The quantity to record against the Alma item. */
  quantity: number;
  converted: boolean;
  /** Set when the count needs a person to look at it. */
  warning: string | null;
  note: string | null;
};

/**
 * Turn a quantity counted in Loaded's unit into a quantity in Alma's.
 *
 * Leaves the quantity alone whenever the two already agree, or whenever there
 * is not enough information to convert honestly — and says so in `warning`
 * rather than converting on a guess.
 */
export function reconcileLoadedQuantity(
  loadedUnit: string,
  quantity: number,
  item: CountUnitTarget
): UnitReconciliation {
  const measure = bareMeasure(loadedUnit);
  if (!measure) {
    // A pack size or a countable thing: both systems are counting the same
    // objects, so the number carries across untouched.
    return { quantity, converted: false, warning: null, note: null };
  }

  // Alma may already count in the very same measure — food counted in Kilo
  // against an item whose count unit is kg. Nothing to do.
  const target = bareMeasure(item.countUnit ?? '');
  if (target && target.dimension === measure.dimension) {
    if (target.perUnit === measure.perUnit) {
      return { quantity, converted: false, warning: null, note: null };
    }
    const scaled = (quantity * measure.perUnit) / target.perUnit;
    return {
      quantity: round2(scaled),
      converted: true,
      warning: null,
      note: `${quantity} ${loadedUnit} → ${round2(scaled)} ${item.countUnit}`
    };
  }

  const per = item.measurePerCountUnit ?? 0;
  const itemMeasure = bareMeasure(item.measureUnit ?? '');
  if (per > 0 && itemMeasure && itemMeasure.dimension === measure.dimension) {
    const inItemMeasure = (quantity * measure.perUnit) / itemMeasure.perUnit;
    const converted = inItemMeasure / per;
    return {
      quantity: round2(converted),
      converted: true,
      warning: null,
      note: `${quantity} ${loadedUnit} ÷ ${per} ${item.measureUnit} per ${item.countUnit} → ${round2(
        converted
      )} ${item.countUnit}`
    };
  }

  // Counted in a measure, but Alma has no size recorded for the item, so there
  // is no honest conversion. Importing the raw number is what caused the
  // original corruption, so it is flagged rather than quietly accepted.
  return {
    quantity,
    converted: false,
    warning: `Counted in ${loadedUnit} but Alma counts this in ${
      item.countUnit ?? 'an unknown unit'
    } and has no size recorded, so the number cannot be converted. Set the item's pack size before importing.`,
    note: null
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type EvidencedReconciliation = UnitReconciliation & {
  /**
   * How the quantity was decided:
   *  - `agreed`      the conversion was checked against what Loaded valued the
   *                  line at, and the chosen reading is the one the two systems
   *                  agree on
   *  - `unit-only`   no conversion was called for
   *  - `no-evidence` a conversion was possible but there was nothing to check it
   *                  against, so the count was left as it was found
   */
  basis: 'agreed' | 'unit-only' | 'no-evidence';
};

/**
 * Convert only when the evidence says the conversion is right.
 *
 * `reconcileLoadedQuantity` trusts `measurePerCountUnit`, and on drinks that is
 * a real bottle size. On food it very often is not: dozens of Alma's food items
 * carry a blanket "100 g per each" that was never a pack size, and converting
 * on it turns 15.39 kg of onions into 153.9 onions and 10.55 kg of tomatoes
 * into $4,405 of tomatoes. Ten times too much, every time.
 *
 * Loaded prints what it thinks each line is worth, so there is no need to guess
 * which reading is meant: work out what Alma would say under each, and keep the
 * one that agrees. On the two real sheets this converts all four millilitre
 * spirits (912x disagreement becomes 1.22x) and declines all thirty-two food
 * conversions (each of which would have been ten times out).
 *
 * With no cost on the Alma item there is nothing to weigh, so the count is left
 * exactly as the person wrote it and the caller is told the difference.
 */
export function reconcileWithEvidence(
  loadedUnit: string,
  quantity: number,
  item: CountUnitTarget & { unitCostCents: number | null },
  loadedValueCents: number
): EvidencedReconciliation {
  const candidate = reconcileLoadedQuantity(loadedUnit, quantity, item);
  if (!candidate.converted) return { ...candidate, basis: 'unit-only' };

  const cost = item.unitCostCents ?? 0;
  if (cost <= 0 || loadedValueCents <= 0) {
    return {
      quantity,
      converted: false,
      note: null,
      warning: `Counted as ${quantity} ${loadedUnit}, which could mean ${candidate.quantity} ${
        item.countUnit ?? 'units'
      } in Alma. There is no cost on the item to tell which, so the count was left as written.`,
      basis: 'no-evidence'
    };
  }

  /** How far a valuation sits from Loaded's, as a factor either way. */
  const disagreement = (qty: number) => {
    const ratio = (qty * cost) / loadedValueCents;
    return ratio <= 0 ? Number.POSITIVE_INFINITY : Math.max(ratio, 1 / ratio);
  };

  return disagreement(candidate.quantity) <= disagreement(quantity)
    ? { ...candidate, basis: 'agreed' }
    : { quantity, converted: false, note: null, warning: null, basis: 'agreed' };
}
