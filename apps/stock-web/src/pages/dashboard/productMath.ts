import type { Recipe } from '@alma/shared';

/** Pure maths behind the product performance section, kept apart so it can be tested. */
export type ProductRow = {
  key: string;
  title: string;
  category: string | null;
  venues: string[];
  units: number;
  netSalesCents: number;
  /** (sell − recipe cost) × units; null when any venue's cost is unusable. */
  profitCents: number | null;
  marginPercent: number | null;
  costed: boolean;
};

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];
export const COMPACT_ROWS = 8;
export const PAGE = 30;

export function toRow(recipe: Recipe, venue: string): ProductRow {
  const sellCents = recipe.venuePrices?.find((p) => p.venue === venue)?.salePriceCents ?? recipe.salePriceCents ?? null;
  const costCents = recipe.portionCostCents ?? null;
  const units = recipe.actualSales?.quantitySold ?? 0;
  const netSalesCents = recipe.actualSales?.netSalesCents ?? 0;
  // Gross profit is what the till took for the dish (net of discounts and
  // refunds) less the recipe cost of every unit — not list price × units,
  // which overstates anything sold on a set menu or special.
  // A cost under 2% of what a unit actually fetched is a recipe with most
  // ingredients uncosted, not a 98% margin — treated as uncosted, like a zero.
  const unitPrice = units > 0 ? netSalesCents / units : sellCents;
  const usable = unitPrice !== null && costCents !== null && unitPrice > 0 && costCents >= unitPrice * 0.02;
  const profit = usable ? Math.round(netSalesCents - costCents * units) : null;
  return {
    key: recipe.id,
    title: recipe.title,
    category: recipe.category ?? null,
    venues: [venue],
    units,
    netSalesCents,
    profitCents: profit,
    marginPercent: profit !== null && netSalesCents > 0 ? (profit / netSalesCents) * 100 : null,
    costed: usable
  };
}

/** Group view: the same dish at both venues becomes one row. */
export function merge(rows: ProductRow[]): ProductRow[] {
  const byTitle = new Map<string, ProductRow>();
  for (const r of rows) {
    const k = r.title.trim().toLowerCase();
    const prev = byTitle.get(k);
    if (!prev) {
      byTitle.set(k, { ...r, key: k });
      continue;
    }
    const profit = prev.profitCents !== null && r.profitCents !== null ? prev.profitCents + r.profitCents : null;
    const sales = prev.netSalesCents + r.netSalesCents;
    byTitle.set(k, {
      ...prev,
      venues: [...prev.venues, ...r.venues],
      units: prev.units + r.units,
      netSalesCents: sales,
      profitCents: profit,
      marginPercent: profit !== null && sales > 0 ? (profit / sales) * 100 : null,
      costed: prev.costed && r.costed,
      category: prev.category ?? r.category
    });
  }
  return [...byTitle.values()];
}

export type ListKind = 'top' | 'earners' | 'slow';
export const LISTS: Record<ListKind, { title: string; hint: string; sortKey: SortKey; desc: boolean }> = {
  top: { title: 'Top sellers', hint: 'by units sold', sortKey: 'units', desc: true },
  earners: { title: 'Top earners', hint: 'net sales less recipe cost', sortKey: 'profit', desc: true },
  slow: { title: 'Slowest sellers', hint: 'fewest units, of those that sold', sortKey: 'units', desc: false }
};
export type SortKey = 'units' | 'sales' | 'profit' | 'margin' | 'name';

export function sortRows(rows: ProductRow[], key: SortKey, desc: boolean) {
  const v = (r: ProductRow) => (key === 'units' ? r.units : key === 'sales' ? r.netSalesCents : key === 'profit' ? (r.profitCents ?? -Infinity) : key === 'margin' ? (r.marginPercent ?? -Infinity) : 0);
  return [...rows].sort((a, b) => {
    if (key === 'name') return desc ? b.title.localeCompare(a.title) : a.title.localeCompare(b.title);
    const d = v(a) - v(b);
    if (d !== 0) return desc ? -d : d;
    return a.netSalesCents - b.netSalesCents || a.title.localeCompare(b.title);
  });
}

