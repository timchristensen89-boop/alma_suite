// One vocabulary for stock units, shared by the API and the web app.
//
// Loaded, suppliers, and people all name the same unit differently: the count
// sheet says "KILO" where the item says "kg", "EACH" where the item says
// "Unit", "700ml" where Alma counts bottles. Every one of those used to read as
// a foreign unit — the line got no value and the stocktake flagged it — even
// though both sides meant the same thing.
//
// Three layers resolve a label here:
//
//  1. Aliases — spellings of the same unit ("kilo" → "kg", "unit" → "each").
//     A default table ships below; the live table is editable in Stock →
//     Setup → Units and is loaded into this module via setActiveUnitAliases,
//     so the server (from the DB) and the browser (from the API) agree.
//  2. Pack-size labels — "700ml", "750 mL", "1 KG", "12 Pack". The digit is
//     the tell: the label names a container, and the quantity counts
//     containers, not millilitres. A "700ml" count against an item counted in
//     bottles is a bottle count. (A bare "mL" with no digit is the opposite —
//     the quantity IS millilitres — and stays untouched here; see
//     loaded-count-units.ts for why converting those on the label alone is
//     what corrupted the stock values.)
//  3. Metric families — g↔kg, mL↔L convert by arithmetic.

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
  // the raw quantity is returned unchanged (caller should warn). 'pack-label'
  // means the counted unit names a container ("700ml") and the item's unit is
  // a countable, so the quantity already counts the same containers.
  // 'measure-pack' bridged a weight/volume line to a count unit via
  // measurePerCountUnit.
  via: 'same-unit' | 'pack' | 'pack-label' | 'measure' | 'measure-pack' | 'unknown';
};

/**
 * Default alias table: alias → canonical token. Keys are matched after
 * lowercasing, whitespace-collapsing, dot-stripping and (for words longer than
 * two characters) dropping a plural 's'. These defaults seed the editable
 * stock_unit_aliases table; once the live table is loaded it replaces this
 * list entirely, so deleting a seeded row in the UI really turns it off.
 */
export const DEFAULT_UNIT_ALIASES: Record<string, string> = {
  // Mass
  gram: 'g',
  gm: 'g',
  grm: 'g',
  gr: 'g',
  kilogram: 'kg',
  kilo: 'kg',
  milligram: 'mg',
  // Volume
  millilitre: 'ml',
  milliliter: 'ml',
  litre: 'l',
  liter: 'l',
  ltr: 'l',
  lt: 'l',
  centilitre: 'cl',
  centiliter: 'cl',
  decilitre: 'dl',
  deciliter: 'dl',
  // Countables
  ea: 'each',
  unit: 'each',
  piece: 'each',
  pc: 'each',
  pce: 'each',
  portion: 'each',
  serve: 'each',
  serving: 'each',
  btl: 'bottle',
  cs: 'case',
  ctn: 'carton',
  bx: 'box',
  // "boxes"/"bunches" lose only the trailing 's' in normalisation.
  boxe: 'box',
  bunche: 'bunch',
  pk: 'pack',
  pkt: 'pack',
  packet: 'pack',
  doz: 'dozen'
};

// The live alias table, when one has been loaded (server: from the DB at boot
// and after every edit; browser: fetched from /api/items/unit-aliases). Null
// means "never loaded" and the defaults above apply — scripts and tests work
// without a database.
let activeAliases: Record<string, string> | null = null;

export function setActiveUnitAliases(aliases: Record<string, string> | null): void {
  activeAliases = aliases;
}

export function getActiveUnitAliases(): Record<string, string> {
  return activeAliases ?? DEFAULT_UNIT_ALIASES;
}

// Base unit = grams for mass, millilitres for volume. Value = base units per 1 of key.
const MASS_TO_GRAMS: Record<string, number> = { mg: 0.001, g: 1, kg: 1000 };
const VOLUME_TO_ML: Record<string, number> = { ml: 1, cl: 10, dl: 100, l: 1000 };

function isBareMeasure(token: string): boolean {
  return token in MASS_TO_GRAMS || token in VOLUME_TO_ML;
}

function aliasLookup(token: string): string {
  const aliases = getActiveUnitAliases();
  const direct = aliases[token];
  if (direct) return direct;
  // Drop a trailing plural 's' for multi-char units (grams -> gram, cases -> case),
  // but keep short symbols like 'g', 'ml', 'kg' intact.
  if (token.length > 2 && token.endsWith('s')) {
    const singular = token.slice(0, -1);
    return aliases[singular] ?? singular;
  }
  return token;
}

export type PackLabel = {
  /** The pack size expressed in base units (g or ml), when the suffix is a measure. */
  baseAmount: number | null;
  /** 'g' | 'ml' when the suffix is a measure, null for "12 Pack"-style labels. */
  baseMeasure: 'g' | 'ml' | null;
};

/**
 * A digit-bearing unit label — "700ml", "750 mL", "1 KG", "20Ltr", "12 Pack".
 * These name a container; a quantity counted in one counts containers.
 * Returns null for labels with no leading number (those are bare units).
 */
export function parsePackLabel(value: string | null | undefined): PackLabel | null {
  const text = (value ?? '').trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(text);
  if (!match || !match[2]) return null;
  const size = Number(match[1]);
  if (!Number.isFinite(size) || size <= 0) return null;
  const suffix = aliasLookup(match[2].replace(/\s+/g, ' ').replace(/\.+$/, '').trim());
  if (suffix in MASS_TO_GRAMS) return { baseAmount: size * MASS_TO_GRAMS[suffix]!, baseMeasure: 'g' };
  if (suffix in VOLUME_TO_ML) return { baseAmount: size * VOLUME_TO_ML[suffix]!, baseMeasure: 'ml' };
  return { baseAmount: null, baseMeasure: null };
}

/**
 * Canonical token for a unit label: lowercased, dots and extra spaces gone,
 * plural stripped, aliases applied. Pack-size labels canonicalise to their
 * base-unit form so "0.7 L", "700ml" and "700 mL" all read the same.
 */
export function normaliseUnitLabel(value: string | null | undefined): string {
  if (!value) return '';
  const cleaned = value.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.+$/, '');
  if (!cleaned) return '';
  const pack = parsePackLabel(cleaned);
  if (pack?.baseAmount) {
    return `${roundForKey(pack.baseAmount)}${pack.baseMeasure}`;
  }
  return aliasLookup(cleaned);
}

function roundForKey(value: number): number {
  return Math.round(value * 1000) / 1000;
}

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
  const from = normaliseUnitLabel(fromUnit);
  const cost = normaliseUnitLabel(costUnitRaw);
  const purchase = normaliseUnitLabel(item.unit);

  // No line unit, or it already matches the cost unit.
  if (!from || from === cost) {
    return { quantity, via: 'same-unit' };
  }

  // A generic count word ("Unit"/"each"/"portion") means one whole count unit
  // of the item, whatever the item's count unit is actually named (bottle,
  // punnet, each…). So "1 Unit" costs as 1 count unit — and pairs with the
  // measure bridge below so Unit / kg / g (or Unit / L / mL) all agree.
  if (from === 'each') {
    return { quantity, via: 'same-unit' };
  }

  // Line is in the purchase unit while cost is per count unit → use the item's
  // pack conversion (count units per purchase unit). Checked before the
  // pack-label rules: a purchase unit can itself be digit-bearing ("12 Pack"
  // bought, bottles counted), and there the conversion factor — not the
  // container identity — is what maps cases to bottles.
  if (
    item.countUnit &&
    cost === normaliseUnitLabel(item.countUnit) &&
    from === purchase &&
    item.conversionFactor &&
    item.conversionFactor > 0
  ) {
    return { quantity: quantity * item.conversionFactor, via: 'pack' };
  }

  // A pack-size label ("700ml", "750 mL", "12 Pack") names a container, and
  // the quantity counts containers. When the item's unit is a countable too
  // (bottle, each, or itself a pack label), both sides are counting the same
  // objects — the number carries across untouched. When the item counts in a
  // bare measure of the same dimension, the containers convert by arithmetic:
  // 2 × "700ml" against an item counted in L is 1.4 L.
  const fromPack = parsePackLabel(fromUnit);
  if (fromPack) {
    if (!isBareMeasure(cost)) {
      return { quantity, via: 'pack-label' };
    }
    if (fromPack.baseAmount && fromPack.baseMeasure) {
      const factor = measureFactor(fromPack.baseMeasure, cost);
      if (factor !== null) {
        return { quantity: quantity * fromPack.baseAmount * factor, via: 'measure' };
      }
    }
    return { quantity, via: 'unknown' };
  }

  // The reverse: the line names a plain countable ("bottle", "each" is handled
  // above) while the item's count unit is a pack label ("700ml"). Same
  // containers, same count.
  if (!isBareMeasure(from) && parsePackLabel(costUnitRaw)) {
    return { quantity, via: 'pack-label' };
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
    const measure = normaliseUnitLabel(item.measureUnit);
    const toMeasure = measureFactor(from, measure); // line qty expressed in the item's measure unit
    if (toMeasure !== null) {
      return { quantity: (quantity * toMeasure) / item.measurePerCountUnit, via: 'measure-pack' };
    }
  }

  return { quantity, via: 'unknown' };
}

/**
 * Convert a quantity between two standard units (Unit / kg / g / L / mL) for
 * prep-recipe (sub-recipe) lines, where the line unit may differ from the prep
 * recipe's yield unit. Same/unspecified units pass through; mL↔L and g↔kg
 * convert via the metric family. Returns null when the two units are genuinely
 * incompatible (e.g. "each" vs "L"), so the caller can warn and fall back to the
 * raw quantity rather than mis-cost by a factor of 1000.
 */
export function convertBetweenUnits(
  quantity: number,
  fromUnit: string | null | undefined,
  toUnit: string | null | undefined
): number | null {
  const from = normaliseUnitLabel(fromUnit);
  const to = normaliseUnitLabel(toUnit);
  if (!from || !to || from === to) return quantity;
  const factor = measureFactor(from, to); // g↔kg, mL↔L
  if (factor !== null) return quantity * factor;
  return null;
}
