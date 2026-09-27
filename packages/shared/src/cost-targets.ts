// The one place cost targets come from, so the Overview, the Monthly Recap
// and the forecast never grade the same month against different numbers.
// Covered by cost-targets.test.ts (apps/api/src/lib).
//
// Background: the Monthly Recap hard-coded wages 30 / COGS 30 / prime 60 in
// the API; the Overview hard-coded food 30 / labour 30 / prime 60 in the
// browser and averaged the venues' prime targets from Settings on top. The
// venue targets an admin sets under Settings › Venues (targetWagePercent,
// targetPrimeCostPercent) are the canonical source; these defaults apply
// only where nothing is set, and every result says which it was.

export const DEFAULT_COST_TARGETS = { wagePct: 30, foodPct: 30, primePct: 60 } as const;

export type VenueTargetInput = {
  name: string;
  targetWagePercent?: number | null;
  targetPrimeCostPercent?: number | null;
};

export type CostTargets = {
  wagePct: number;
  foodPct: number;
  primePct: number;
  /** Which venue the targets are for; null = the group. */
  venue: string | null;
  /** venue: that venue's settings; group_average: the mean of venues with settings; default: nothing configured. */
  source: 'venue' | 'group_average' | 'default';
  /** Which of the three came from settings rather than the default. */
  configured: { wage: boolean; prime: boolean };
};

const isPct = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const round1 = (value: number) => Math.round(value * 10) / 10;

function fromPair(wage: number | null, prime: number | null, venue: string | null, source: CostTargets['source']): CostTargets {
  const wagePct = wage ?? DEFAULT_COST_TARGETS.wagePct;
  const primePct = prime ?? DEFAULT_COST_TARGETS.primePct;
  // Food is what prime leaves after labour; when only one is configured the
  // default for the other still gives a consistent triangle.
  const foodPct = round1(Math.max(0, primePct - wagePct));
  return { wagePct, foodPct, primePct, venue, source, configured: { wage: wage != null, prime: prime != null } };
}

export function resolveCostTargets(venues: ReadonlyArray<VenueTargetInput>, venue: string | null | undefined): CostTargets {
  const name = venue?.trim() || null;
  if (name) {
    const row = venues.find((v) => v.name.trim().toLowerCase() === name.toLowerCase());
    const wage = row && isPct(row.targetWagePercent) ? row.targetWagePercent : null;
    const prime = row && isPct(row.targetPrimeCostPercent) ? row.targetPrimeCostPercent : null;
    if (wage == null && prime == null) return fromPair(null, null, name, 'default');
    return fromPair(wage, prime, name, 'venue');
  }
  const wages = venues.map((v) => v.targetWagePercent).filter(isPct);
  const primes = venues.map((v) => v.targetPrimeCostPercent).filter(isPct);
  if (wages.length === 0 && primes.length === 0) return fromPair(null, null, null, 'default');
  const mean = (values: number[]) => (values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null);
  return fromPair(mean(wages), mean(primes), null, 'group_average');
}
