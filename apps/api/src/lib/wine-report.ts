/**
 * What the wine list is actually doing: which grapes and regions sell, which
 * price bands move, whether the glass pours pay, what margin the list carries,
 * and what has been sitting there not selling.
 *
 * Pure so every rollup can be tested without a database — and because the two
 * traps in a report like this are arithmetic, not plumbing:
 *
 *  1. A wine with no cost recorded reads as 100% margin and tops the table.
 *     Margin here is computed ONLY over the revenue that has a cost behind it
 *     (see costedRevenueCents), and the uncosted revenue is reported alongside
 *     so nobody reads a partial number as a whole one.
 *
 *  2. "Not selling" and "never sold" are different facts. A wine that sold six
 *     months ago is slow; a wine that has never sold since it went on the list
 *     may not even be ringing up correctly. They are separated, not merged into
 *     one "days since" column with a large number standing in for never.
 *
 * Covered by wine-report.test.ts.
 */

/** A pour of a wine, as the register sells it. */
export type PourFact = {
  recipeId: string;
  ml: number;
  salePriceCents: number | null;
  /** What the pour costs. NULL = no cost recorded, which is not zero. */
  costCents: number | null;
};

export type WineFact = {
  id: string;
  venue: string;
  /** Producer, cuvée and vintage as the list prints it. */
  name: string;
  grape: string | null;
  region: string | null;
  origin: string | null;
  vintage: number | null;
  section: string | null;
  limitedStock: boolean;
  sommelierPour: boolean;
  pours: PourFact[];
};

/** One sale of one pour. Both registers feed the same shape. */
export type SaleFact = {
  recipeId: string;
  quantity: number;
  revenueCents: number;
  /** Trading day, ISO yyyy-mm-dd. */
  date: string;
  /** Which system rang it, so a window spanning the changeover stays legible. */
  source: 'register' | 'imported';
};

/**
 * A bottle is 700mL or more. Below that it is a glass or a carafe, and the
 * question the report answers about it is a different one: does pouring this
 * wine by the glass pay for the bottle you open to do it.
 */
export const BOTTLE_ML = 700;

export function isBottle(ml: number): boolean {
  return ml >= BOTTLE_ML;
}

/**
 * The register's own price bands (WINE_BANDS in pos-web), so a somm filtering
 * "under $80" at the till and a manager reading this report are cutting the
 * list the same way.
 *
 * Banded on the BOTTLE price, not the cheapest pour: the trade question is
 * what a bottle of this fetches. A wine sold only by the glass bands on its
 * largest pour, and one with no price at all is reported rather than banded.
 */
export const PRICE_BANDS = [
  { id: 'u80', label: 'Under $80', max: 8000 },
  { id: '80-120', label: '$80–120', max: 12000 },
  { id: '120-200', label: '$120–200', max: 20000 },
  { id: '200+', label: '$200+', max: Number.POSITIVE_INFINITY }
] as const;

export function priceBand(cents: number | null): (typeof PRICE_BANDS)[number] | null {
  if (cents === null || cents <= 0) return null;
  return PRICE_BANDS.find((band) => cents < band.max) ?? PRICE_BANDS[PRICE_BANDS.length - 1] ?? null;
}

/** What a bottle of this wine costs a guest, for banding and for the shelf value. */
export function bottlePriceCents(wine: WineFact): number | null {
  const priced = wine.pours.filter((pour) => pour.salePriceCents !== null && pour.salePriceCents > 0);
  if (priced.length === 0) return null;
  const bottles = priced.filter((pour) => isBottle(pour.ml));
  const pool = bottles.length > 0 ? bottles : priced;
  // The largest pour: a wine sold in 150/250/750 bands on the 750.
  return pool.reduce((best, pour) => (pour.ml > best.ml ? pour : best), pool[0]!).salePriceCents;
}

export function poursizeLabel(ml: number): string {
  return isBottle(ml) ? `Bottle (${ml}mL)` : `${ml}mL glass`;
}

export type Bucket = {
  key: string;
  label: string;
  /** Wines on the list in this bucket, whether or not they sold. */
  wines: number;
  bottles: number;
  glasses: number;
  quantity: number;
  revenueCents: number;
  /**
   * The slice of revenueCents whose pours carry a cost. Margin below is over
   * THIS, not over everything — otherwise an uncosted wine reads as pure profit.
   */
  costedRevenueCents: number;
  costCents: number;
  /** Ex-GST on both sides — see marginPercent. */
  marginCents: number;
  marginPercent: number | null;
  /** Share of all wine revenue in the window. */
  sharePercent: number | null;
};

/**
 * Australian GST. The register takes money GST inclusive; the stocktake sheets
 * the wine costs come from are ex-GST.
 */
export const GST_RATE = 0.1;

/** What the venue actually keeps out of a GST-inclusive till figure. */
export function exGstCents(inclusiveCents: number): number {
  return Math.round(inclusiveCents / (1 + GST_RATE));
}

/**
 * Margin over the revenue we can actually cost. NULL when nothing in the
 * bucket has a cost — an empty column is honest, 100% is not.
 *
 * BOTH SIDES EX-GST. Revenue arrives here GST inclusive (till takings) and
 * cost arrives ex-GST (the bar stocktake prices a bottle ex-GST), so comparing
 * them raw counted the GST as margin and read about nine points high — a
 * $73 bottle costing $13.54 showed 81% when the truth is 79.6%. Wine GP is
 * quoted ex-GST on both sides in every venue Tim has run, so revenue drops to
 * ex-GST here rather than cost being grossed up.
 *
 * revenueCents on the bucket stays inclusive on purpose: that is the number
 * that reconciles against the day's takings.
 */
export function marginPercent(costedRevenueCents: number, costCents: number): number | null {
  if (costedRevenueCents <= 0) return null;
  const net = exGstCents(costedRevenueCents);
  return ((net - costCents) / net) * 100;
}

/** Margin in dollars, on the same ex-GST basis as marginPercent. */
export function marginCentsOf(costedRevenueCents: number, costCents: number): number {
  return exGstCents(costedRevenueCents) - costCents;
}

type Line = { wine: WineFact; pour: PourFact; sale: SaleFact };

/**
 * Roll sales up by whatever key the caller names — grape, region, band, pour
 * size. Wines are counted per bucket even with no sales, so a grape that is
 * on the list and never sells still has a row saying so.
 */
export function bucketBy(
  lines: Line[],
  winesInBucket: Map<string, Set<string>>,
  keyOf: (line: Line) => { key: string; label: string } | null,
  totalRevenueCents: number
): Bucket[] {
  const buckets = new Map<string, Bucket>();

  const blank = (key: string, label: string): Bucket => ({
    key,
    label,
    wines: 0,
    bottles: 0,
    glasses: 0,
    quantity: 0,
    revenueCents: 0,
    costedRevenueCents: 0,
    costCents: 0,
    marginCents: 0,
    marginPercent: null,
    sharePercent: null
  });

  for (const line of lines) {
    const named = keyOf(line);
    if (!named) continue;
    const bucket = buckets.get(named.key) ?? blank(named.key, named.label);
    bucket.quantity += line.sale.quantity;
    bucket.revenueCents += line.sale.revenueCents;
    if (isBottle(line.pour.ml)) bucket.bottles += line.sale.quantity;
    else bucket.glasses += line.sale.quantity;
    if (line.pour.costCents !== null) {
      bucket.costedRevenueCents += line.sale.revenueCents;
      bucket.costCents += line.pour.costCents * line.sale.quantity;
    }
    buckets.set(named.key, bucket);
  }

  // Buckets a wine belongs to but never sold from still get a row.
  for (const [key, wineIds] of winesInBucket) {
    const bucket = buckets.get(key) ?? blank(key, key);
    bucket.wines = wineIds.size;
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      marginCents: marginCentsOf(bucket.costedRevenueCents, bucket.costCents),
      marginPercent: marginPercent(bucket.costedRevenueCents, bucket.costCents),
      sharePercent: totalRevenueCents > 0 ? (bucket.revenueCents / totalRevenueCents) * 100 : null
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents || b.wines - a.wines || a.label.localeCompare(b.label));
}

export type AgingRow = {
  wineId: string;
  venue: string;
  name: string;
  vintage: number | null;
  /** Years since the vintage, at the report's end date. NULL for non-vintage. */
  vintageAge: number | null;
  bottlePriceCents: number | null;
  soldInWindow: number;
  /** The last sale of ANY pour, from either register. NULL = never sold. */
  lastSoldAt: string | null;
  daysSinceSold: number | null;
  limitedStock: boolean;
};

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/**
 * What is not moving, worst first.
 *
 * Never-sold comes before long-ago-sold, and inside each the dearest bottle
 * first — a $660 Barolo nobody has ever rung is a different problem from a $16
 * glass that went quiet, and the list should say so in that order.
 */
export function agingWines(
  wines: WineFact[],
  soldInWindow: Map<string, number>,
  lastSoldAt: Map<string, string>,
  asOfIso: string
): AgingRow[] {
  const year = Number(asOfIso.slice(0, 4));
  return wines
    .map((wine) => {
      const last = lastSoldAt.get(wine.id) ?? null;
      return {
        wineId: wine.id,
        venue: wine.venue,
        name: wine.name,
        vintage: wine.vintage,
        vintageAge: wine.vintage && Number.isFinite(year) ? year - wine.vintage : null,
        bottlePriceCents: bottlePriceCents(wine),
        soldInWindow: soldInWindow.get(wine.id) ?? 0,
        lastSoldAt: last,
        daysSinceSold: last ? daysBetween(last, asOfIso) : null,
        limitedStock: wine.limitedStock
      };
    })
    .filter((row) => row.soldInWindow === 0)
    .sort((a, b) => {
      const neverA = a.daysSinceSold === null ? 0 : 1;
      const neverB = b.daysSinceSold === null ? 0 : 1;
      if (neverA !== neverB) return neverA - neverB;
      if (a.daysSinceSold !== null && b.daysSinceSold !== null && a.daysSinceSold !== b.daysSinceSold) {
        return b.daysSinceSold - a.daysSinceSold;
      }
      return (b.bottlePriceCents ?? 0) - (a.bottlePriceCents ?? 0);
    });
}
