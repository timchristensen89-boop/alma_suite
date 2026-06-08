// Unit conversion for recipe costing.
//
// A stock item's average cost (`avgCostCents`) is denominated in its COST UNIT,
// which is `countUnit ?? unit` (the sale/count unit when set, otherwise the
// purchase unit). Recipe lines carry a `quantity` in their own `unit`, which may
// differ from the cost unit. To cost a line correctly we must express the line
// quantity in the item's cost unit before multiplying by the per-cost-unit price.
//
// Conversions we can resolve safely:
//  1. Same unit                      → factor 1.
//  2. Line unit == purchase unit and
//     cost unit == count unit         → multiply by `conversionFactor`
//                                       (count units per purchase unit).
//  3. Same measurement family
//     (metric mass or metric volume)  → convert via base-unit ratios.
//
// Anything else is left unconverted and flagged, so we never silently emit a
// wrong cost from an assumption we can't justify.

export type CostUnitItem = {
  unit: string;
  countUnit: string | null;
  conversionFactor: number | null;
  // Net measurable amount in one count/cost unit (e.g. a punnet ≈ 250 g), and
  // the unit it's expressed in ('g' or 'ml'). Lets us cost a weight/volume
  // recipe line against an item that is counted/costed by a count unit.
  measurePerCountUnit?: number | null;
  measureUnit?: string | null;
};

export type QuantityConversion = {
  // Quantity expressed in the item's cost unit.
  quantity: number;
  // How the conversion was resolved. 'unknown' means we could not convert and
  // the raw quantity is returned unchanged (caller should warn). 'measure-pack'
  // bridged a weight/volume line to a count unit via measurePerCountUnit.
  via: 'same-unit' | 'pack' | 'measure' | 'measure-pack' | 'unknown';
};

function normaliseUnit(value: string | null | undefined): string {
  if (!value) return '';
  let u = value.trim().toLowerCase();
  // Drop a trailing plural 's' for multi-char units (grams -> gram, cases -> case),
  // but keep short symbols like 'g', 'ml', 'kg' intact.
  if (u.length > 2 && u.endsWith('s')) u = u.slice(0, -1);
  return UNIT_ALIASES[u] ?? u;
}

// Canonicalise common spellings/symbols to a single token per unit.
const UNIT_ALIASES: Record<string, string> = {
  gram: 'g',
  gm: 'g',
  grm: 'g',
  kilogram: 'kg',
  kilo: 'kg',
  milligram: 'mg',
  litre: 'l',
  liter: 'l',
  millilitre: 'ml',
  milliliter: 'ml',
  centilitre: 'cl',
  centiliter: 'cl',
  decilitre: 'dl',
  deciliter: 'dl',
  ea: 'each',
  unit: 'each',
  piece: 'each',
  pc: 'each',
  portion: 'each',
  serve: 'each',
  serving: 'each'
};

// Base unit = grams for mass, millilitres for volume. Value = base units per 1 of key.
const MASS_TO_GRAMS: Record<string, number> = { mg: 0.001, g: 1, kg: 1000 };
const VOLUME_TO_ML: Record<string, number> = { ml: 1, cl: 10, dl: 100, l: 1000 };

function measureFactor(from: string, to: string): number | null {
  if (from in MASS_TO_GRAMS && to in MASS_TO_GRAMS) {
    return MASS_TO_GRAMS[from]! / MASS_TO_GRAMS[to]!;
  }
  if (from in VOLUME_TO_ML && to in VOLUME_TO_ML) {
    return VOLUME_TO_ML[from]! / VOLUME_TO_ML[to]!;
  }
  return null;
}

/**
 * Express `quantity` (given in `fromUnit`) in the cost unit of `item`.
 * Returns the converted quantity plus how it was resolved. When the units are
 * incompatible and no conversion is known, returns the raw quantity with
 * via='unknown' so the caller can warn rather than silently mis-cost.
 */
export function convertQuantityToCostUnit(
  quantity: number,
  fromUnit: string | null | undefined,
  item: CostUnitItem
): QuantityConversion {
  const costUnitRaw = item.countUnit ?? item.unit;
  const from = normaliseUnit(fromUnit);
  const cost = normaliseUnit(costUnitRaw);
  const purchase = normaliseUnit(item.unit);

  // No line unit, or it already matches the cost unit.
  if (!from || from === cost) {
    return { quantity, via: 'same-unit' };
  }

  // Line is in the purchase unit while cost is per count unit → use the item's
  // pack conversion (count units per purchase unit).
  if (
    item.countUnit &&
    cost === normaliseUnit(item.countUnit) &&
    from === purchase &&
    item.conversionFactor &&
    item.conversionFactor > 0
  ) {
    return { quantity: quantity * item.conversionFactor, via: 'pack' };
  }

  // Same metric measurement family (mass or volume).
  const factor = measureFactor(from, cost);
  if (factor !== null) {
    return { quantity: quantity * factor, via: 'measure' };
  }

  // Line is a weight/volume but the cost unit is a count unit (punnet, bunch,
  // each…). Bridge via the item's declared measure-per-count-unit: express the
  // line in the item's measure unit, then divide by how much one count unit
  // holds to get the number of count units. e.g. 12 g ÷ (250 g / punnet) =
  // 0.048 punnet.
  if (item.measurePerCountUnit && item.measurePerCountUnit > 0 && item.measureUnit) {
    const measure = normaliseUnit(item.measureUnit);
    const toMeasure = measureFactor(from, measure); // line qty expressed in the item's measure unit
    if (toMeasure !== null) {
      return { quantity: (quantity * toMeasure) / item.measurePerCountUnit, via: 'measure-pack' };
    }
  }

  return { quantity, via: 'unknown' };
}
