/**
 * What an item's own purchase history says about buying it again.
 *
 * The supplier price list is the "proper" home for this and it is empty — 0
 * rows in production, because it is a second catalogue somebody would have to
 * maintain by hand alongside the invoices they already enter. The invoices
 * already record who sold what, when, and for how much. This derives the
 * answer from those instead of asking for the data twice.
 *
 * Pure, so it can be tested against real purchase shapes and so the ordering
 * screen and the API agree on what "last price" means.
 */

export type PurchaseLine = {
  supplierId: string | null;
  supplierName: string | null;
  /**
   * What the invoice called the unit amount — which in this data is often the
   * whole line total. See effectiveUnitPriceCents.
   */
  unitAmountCents: number;
  lineAmountCents?: number;
  quantity: number;
  /** The supplier's own text, which frequently states the real quantity. */
  description?: string | null;
  /** Invoice date, not import date — when the price was actually paid. */
  purchasedAt: string | Date;
};

/**
 * How many units this line actually covers.
 *
 * The import records quantity as 1 on a large share of lines and puts the real
 * figure only in the description — "Ordered: 4 units, Supplied Qty: 5 units",
 * or "Supplied Qty: 4.7 KG" for random-weight goods. Where that happens the
 * "unit amount" is really the line total.
 */
export function suppliedQuantity(line: Pick<PurchaseLine, 'quantity' | 'description'>): number {
  const stated = line.description?.match(/supplied qty:\s*([\d.]+)/i);
  if (stated) {
    const value = Number(stated[1]);
    // Only trust the description when the structured quantity is the
    // placeholder 1 — where the importer recorded a real quantity, that is the
    // better source.
    if (Number.isFinite(value) && value > 0 && (line.quantity <= 1)) return value;
  }
  return line.quantity > 0 ? line.quantity : 1;
}

/**
 * What one unit actually cost.
 *
 * Deriving this from lineAmount ÷ quantity rather than trusting unitAmount is
 * not pedantry. Haloumi is a flat $17 a unit across every purchase, but is
 * recorded as 1 × $85 when five were supplied and 1 × $170 when ten were —
 * so a "last price paid" read straight off unitAmount would price an order
 * ten times too high.
 */
export function effectiveUnitPriceCents(line: PurchaseLine): number {
  const units = suppliedQuantity(line);
  const total = line.lineAmountCents ?? line.unitAmountCents * (line.quantity > 0 ? line.quantity : 1);
  if (units > 0 && total > 0) return Math.round(total / units);
  return line.unitAmountCents;
}

export type PurchaseFacts = {
  /** Who to buy it from. Null when nothing has ever been bought. */
  supplierId: string | null;
  supplierName: string | null;
  /** How sure that supplier is: 1 when they are the only one ever used. */
  supplierShare: number;
  lastPriceCents: number | null;
  lastPurchasedAt: string | null;
  /** Lowest and highest unit price ever paid, for judging the last one. */
  lowPriceCents: number | null;
  highPriceCents: number | null;
  /**
   * How far the last price sits above the cheapest ever paid, as a fraction.
   * 0.25 means the last purchase cost a quarter more than the best price seen.
   * Null when there is nothing to compare against.
   */
  priceMovement: number | null;
  purchaseCount: number;
  totalQuantity: number;
};

const EMPTY: PurchaseFacts = {
  supplierId: null,
  supplierName: null,
  supplierShare: 0,
  lastPriceCents: null,
  lastPurchasedAt: null,
  lowPriceCents: null,
  highPriceCents: null,
  priceMovement: null,
  purchaseCount: 0,
  totalQuantity: 0
};

function toTime(value: string | Date): number {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Reduce an item's purchase lines to the facts an order needs.
 *
 * Choosing the supplier: most recent, tie-broken by how often they have been
 * used. Purely-most-frequent would keep recommending a supplier you stopped
 * using months ago; purely-most-recent would let one emergency substitute
 * purchase redefine where an item comes from. In this data the question is
 * nearly always moot — 122 of 123 items with history have only ever been
 * bought from one supplier — so the rule matters most for the rare item where
 * it is genuinely contested, and there recency should lead.
 */
export function summarisePurchases(lines: PurchaseLine[]): PurchaseFacts {
  const usable = lines
    .filter((line) => line.unitAmountCents > 0 || (line.lineAmountCents ?? 0) > 0)
    .map((line) => ({ ...line, effectiveCents: effectiveUnitPriceCents(line) }))
    .filter((line) => line.effectiveCents > 0);
  if (usable.length === 0) return { ...EMPTY };

  const byTimeDesc = [...usable].sort((a, b) => toTime(b.purchasedAt) - toTime(a.purchasedAt));
  const latest = byTimeDesc[0]!;

  // Recency wins, frequency breaks the tie.
  const counts = new Map<string, { count: number; name: string | null; lastAt: number }>();
  for (const line of usable) {
    const key = line.supplierId ?? '__unknown__';
    const current = counts.get(key);
    const at = toTime(line.purchasedAt);
    if (current) {
      current.count += 1;
      if (at > current.lastAt) current.lastAt = at;
    } else {
      counts.set(key, { count: 1, name: line.supplierName, lastAt: at });
    }
  }
  const ranked = [...counts.entries()].sort((a, b) =>
    b[1].lastAt - a[1].lastAt || b[1].count - a[1].count
  );
  const [supplierKey, supplierStats] = ranked[0]!;

  const prices = usable.map((line) => line.effectiveCents);
  const low = Math.min(...prices);
  const high = Math.max(...prices);

  return {
    supplierId: supplierKey === '__unknown__' ? null : supplierKey,
    supplierName: supplierStats.name,
    supplierShare: Number((supplierStats.count / usable.length).toFixed(2)),
    lastPriceCents: latest.effectiveCents,
    lastPurchasedAt: new Date(toTime(latest.purchasedAt)).toISOString(),
    lowPriceCents: low,
    highPriceCents: high,
    // Against the CHEAPEST ever paid, not the previous purchase: a price that
    // crept up over four deliveries shows nothing purchase-to-purchase but a
    // lot against where it started. 37 of 123 items moved over 20%.
    priceMovement: low > 0 && usable.length > 1
      ? Number(((latest.effectiveCents - low) / low).toFixed(3))
      : null,
    purchaseCount: usable.length,
    totalQuantity: Number(usable.reduce((sum, line) => sum + suppliedQuantity(line), 0).toFixed(3))
  };
}

/**
 * How much to order to bring an item back to par, in whole purchase units.
 *
 * Rounds UP: ordering 2 cases when you need 2.1 leaves you short, and the
 * whole point of a par level is not running out. Returns 0 when nothing is
 * needed so a caller can drop the line rather than send a supplier a zero.
 */
export function orderQuantityToPar(params: {
  onHand: number;
  parLevel: number;
  /** Count units per purchase unit. A case of 24 has a factor of 24. */
  conversionFactor?: number | null;
  /** Already on the way, so it is not ordered twice. */
  onOrder?: number;
}): number {
  const factor = params.conversionFactor && params.conversionFactor > 0 ? params.conversionFactor : 1;
  const shortfallCountUnits = params.parLevel - params.onHand - (params.onOrder ?? 0);
  if (shortfallCountUnits <= 0) return 0;
  return Math.ceil(shortfallCountUnits / factor);
}
