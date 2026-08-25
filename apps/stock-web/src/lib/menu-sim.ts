/**
 * Menu-lab arithmetic: what happens to the WHOLE menu's COGS when dishes are
 * removed, replaced or repriced.
 *
 * The point of this file existing is one fact: blended menu COGS is
 * sales-mix-weighted — Σ(qty × cost) / Σ(qty × sell) — not an average of dish
 * percentages. Removing one cheap-to-make dish moves every other dish's share
 * of the mix, so the menu's number moves in ways per-dish figures never show.
 *
 * Everything here is pure (baseline in, simulated menu out) so the register
 * of what-if changes can be replayed live in the browser and unit-tested
 * without a server.
 */

export type SimDish = {
  id: string;
  title: string;
  /** Redistribution group — dishes guests would order instead (the category). */
  group: string;
  /** Units sold in the window. Fractional after redistribution. */
  qty: number;
  priceCents: number;
  costCents: number;
};

export type SimChange =
  | { kind: 'remove'; id: string }
  | { kind: 'replace'; id: string; title: string; priceCents: number; costCents: number }
  | { kind: 'edit'; id: string; priceCents: number; costCents: number };

export type MenuTotals = {
  revenueCents: number;
  costCents: number;
  gpCents: number;
  /** null when the menu has no revenue — a percentage of nothing is a lie. */
  cogsPercent: number | null;
};

export function menuTotals(rows: SimDish[]): MenuTotals {
  let revenueCents = 0;
  let costCents = 0;
  for (const row of rows) {
    revenueCents += row.qty * row.priceCents;
    costCents += row.qty * row.costCents;
  }
  revenueCents = Math.round(revenueCents);
  costCents = Math.round(costCents);
  return {
    revenueCents,
    costCents,
    gpCents: revenueCents - costCents,
    cogsPercent: revenueCents > 0 ? (costCents / revenueCents) * 100 : null
  };
}

/**
 * Apply a set of what-if changes to the baseline menu.
 *
 * Replace and edit keep the dish's sales volume — the assumption is the new
 * dish (or new price) inherits the old one's demand, which is the question
 * the person running the simulation is actually asking.
 *
 * Remove has two honest interpretations, chosen by `redistribute`:
 *  - true (default): the venue is still full — guests who would have ordered
 *    the dead dish order something else FROM THE SAME GROUP, split across the
 *    survivors in proportion to how they already sell. Group volume holds.
 *  - false: those sales simply disappear (the pessimistic bound).
 * A removed dish whose group has no other sellers loses its volume either
 * way — there is nothing for the demand to flow into.
 */
export function applySimChanges(baseline: SimDish[], changes: SimChange[], redistribute: boolean): SimDish[] {
  const byId = new Map<string, SimChange>();
  for (const change of changes) byId.set(change.id, change);

  const survivors: SimDish[] = [];
  const removed: SimDish[] = [];
  for (const row of baseline) {
    const change = byId.get(row.id);
    if (!change) {
      survivors.push({ ...row });
    } else if (change.kind === 'remove') {
      removed.push(row);
    } else if (change.kind === 'replace') {
      survivors.push({ ...row, title: change.title, priceCents: change.priceCents, costCents: change.costCents });
    } else {
      survivors.push({ ...row, priceCents: change.priceCents, costCents: change.costCents });
    }
  }

  if (!redistribute || removed.length === 0) return survivors;

  // Per group: how much volume died, and how much surviving volume can absorb it.
  const removedQtyByGroup = new Map<string, number>();
  for (const row of removed) {
    removedQtyByGroup.set(row.group, (removedQtyByGroup.get(row.group) ?? 0) + row.qty);
  }
  const survivorQtyByGroup = new Map<string, number>();
  for (const row of survivors) {
    if (row.qty > 0) survivorQtyByGroup.set(row.group, (survivorQtyByGroup.get(row.group) ?? 0) + row.qty);
  }

  return survivors.map((row) => {
    const pool = removedQtyByGroup.get(row.group) ?? 0;
    const base = survivorQtyByGroup.get(row.group) ?? 0;
    if (pool <= 0 || base <= 0 || row.qty <= 0) return row;
    return { ...row, qty: row.qty * (1 + pool / base) };
  });
}

/** The difference the changes make, ready for the summary strip. */
export function simDelta(before: MenuTotals, after: MenuTotals): {
  cogsPointDelta: number | null;
  gpDeltaCents: number;
} {
  return {
    cogsPointDelta:
      before.cogsPercent != null && after.cogsPercent != null ? after.cogsPercent - before.cogsPercent : null,
    gpDeltaCents: after.gpCents - before.gpCents
  };
}
