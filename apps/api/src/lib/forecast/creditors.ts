// Creditor distribution engine.
//
// These figures determine what real creditors are offered under a deed, so the
// rules are encoded explicitly and tested rather than left to a spreadsheet:
//
//   1. Only EXTERNAL claims participate by default. Director loans,
//      intercompany, secured, priority and contingent claims are excluded
//      unless a switch is turned on deliberately.
//   2. No creditor may be paid more than their admitted claim — the total
//      reaching creditors is capped at 100 cents in the dollar.
//   3. The performance contribution is the LESSER of the contractual cap, what
//      the performance formula actually earned, and the amount still required
//      to reach 100 cents.
//
// Everything is integer cents. Nothing here is a forecast — these are proposal
// terms applied to an admitted claim pool.

export type CreditorClass =
  | "EXTERNAL_TRADE"
  | "DIRECTOR_LOAN"
  | "INTERCOMPANY"
  | "SECURED"
  | "PRIORITY_EMPLOYEE"
  | "RELATED_PARTY"
  | "CONTINGENT"
  | "STATUTORY";

export interface CreditorClaimInput {
  creditorName: string;
  creditorClass: CreditorClass;
  claimedAmountCents: number;
  /** Admitted by the administrator. Falls back to claimed when not yet assessed. */
  admittedAmountCents?: number | null;
  proofOfDebtStatus?: "CLAIMED" | "ADMITTED" | "REJECTED" | "WITHDRAWN";
  excludedFromDistribution?: boolean;
}

/** Which non-external classes participate. All default to off. */
export interface ParticipationSwitches {
  includeDirectorLoans?: boolean;
  includeIntercompany?: boolean;
  includeSecuredShortfall?: boolean;
  includePriorityClaims?: boolean;
  includeContingentClaims?: boolean;
}

const CLASS_SWITCH: Partial<Record<CreditorClass, keyof ParticipationSwitches>> = {
  DIRECTOR_LOAN: "includeDirectorLoans",
  INTERCOMPANY: "includeIntercompany",
  SECURED: "includeSecuredShortfall",
  PRIORITY_EMPLOYEE: "includePriorityClaims",
  CONTINGENT: "includeContingentClaims",
  RELATED_PARTY: "includeDirectorLoans",
};

/**
 * The pool a dividend is calculated against. A REJECTED or WITHDRAWN proof
 * never participates. An unassessed claim contributes its claimed amount so
 * the pool is not understated before adjudication.
 */
export function admittedExternalPoolCents(
  claims: CreditorClaimInput[],
  switches: ParticipationSwitches = {},
): number {
  return claims.reduce((total, claim) => {
    if (claim.excludedFromDistribution) return total;
    if (claim.proofOfDebtStatus === "REJECTED" || claim.proofOfDebtStatus === "WITHDRAWN") return total;

    if (claim.creditorClass !== "EXTERNAL_TRADE" && claim.creditorClass !== "STATUTORY") {
      const switchKey = CLASS_SWITCH[claim.creditorClass];
      if (!switchKey || switches[switchKey] !== true) return total;
    }

    const amount = claim.admittedAmountCents ?? claim.claimedAmountCents;
    return total + Math.max(0, amount);
  }, 0);
}

export interface DistributionInput {
  /** Contractual fixed contribution across the whole term. */
  fixedTotalCents: number;
  /** Fixed instalments already paid, for a mid-term recalculation. */
  fixedPaidToDateCents?: number;
  /** Contractual ceiling on the performance contribution. */
  performanceCapCents: number;
  /**
   * What the performance formula has actually earned (25% of free cash above
   * the agreed base). Omit to model the maximum case — the brief's headline
   * estimate assumes performance is fully earned.
   */
  earnedPerformanceCents?: number;
  /** Admitted external pool the dividend is measured against. */
  admittedExternalPoolCents: number;
  /** Deed costs funded out of the proposal, so they reduce what reaches creditors. */
  deedCostsFundedFromProposalCents?: number;
}

export interface DistributionResult {
  admittedExternalPoolCents: number;
  fixedDistributionCents: number;
  performancePaymentCents: number;
  /** Total contributed by the company under the proposal. */
  totalContributionCents: number;
  /** What actually reaches creditors after deed costs. */
  distributedToCreditorsCents: number;
  /** Return in cents per dollar of admitted claim, 0–100. */
  centsInDollar: number;
  /** Why the performance payment stopped where it did. */
  performanceLimitedBy: "NOT_REQUIRED" | "CONTRACTUAL_CAP" | "EARNED_PERFORMANCE" | "HUNDRED_CENTS";
  /** True when creditors are made whole. */
  fullyPaid: boolean;
}

/**
 * Apply a proposal to an admitted pool.
 *
 * Performance top-up, per the deed:
 *
 *   MIN(
 *     contractual cap,
 *     earned performance,
 *     MAX(0, admitted pool + deed costs from proposal - fixed already distributed)
 *   )
 *
 * The third term is what stops creditors being paid beyond 100 cents.
 */
export function computeDistribution(input: DistributionInput): DistributionResult {
  const pool = Math.max(0, Math.round(input.admittedExternalPoolCents));
  const deedCosts = Math.max(0, Math.round(input.deedCostsFundedFromProposalCents ?? 0));
  const fixedTotal = Math.max(0, Math.round(input.fixedTotalCents));
  const performanceCap = Math.max(0, Math.round(input.performanceCapCents));
  const earned = input.earnedPerformanceCents === undefined
    ? Number.POSITIVE_INFINITY
    : Math.max(0, Math.round(input.earnedPerformanceCents));

  // Fixed contributions net of deed costs are what actually reach creditors.
  const fixedReachingCreditors = Math.max(0, fixedTotal - deedCosts);

  // Still owed to reach 100 cents, expressed as a contribution (so deed costs
  // funded from the proposal have to be covered too).
  const requiredToReachFull = Math.max(0, pool + deedCosts - fixedTotal);

  const performance = Math.min(performanceCap, earned, requiredToReachFull);

  let performanceLimitedBy: DistributionResult["performanceLimitedBy"];
  if (requiredToReachFull === 0) performanceLimitedBy = "NOT_REQUIRED";
  else if (performance === requiredToReachFull) performanceLimitedBy = "HUNDRED_CENTS";
  else if (performance === performanceCap) performanceLimitedBy = "CONTRACTUAL_CAP";
  else performanceLimitedBy = "EARNED_PERFORMANCE";

  const totalContribution = fixedTotal + performance;
  // Hard ceiling: creditors can never receive more than their admitted claims.
  const distributedToCreditors = Math.min(pool, fixedReachingCreditors + performance);
  const centsInDollar = pool === 0 ? 0 : Math.min(100, (distributedToCreditors / pool) * 100);

  return {
    admittedExternalPoolCents: pool,
    fixedDistributionCents: fixedTotal,
    performancePaymentCents: performance,
    totalContributionCents: totalContribution,
    distributedToCreditorsCents: distributedToCreditors,
    centsInDollar,
    performanceLimitedBy,
    fullyPaid: pool > 0 && distributedToCreditors >= pool,
  };
}

/**
 * 25% (or the agreed share) of free cash above the agreed base forecast, across
 * the proposal years. Only upside counts — a year below base contributes zero
 * and does not net off a good year.
 */
export function earnedPerformanceCents(
  years: Array<{ actualFreeCashCents: number; baseForecastFreeCashCents: number }>,
  sharePercent: number,
): number {
  const share = Math.max(0, sharePercent) / 100;
  return years.reduce((total, year) => {
    const excess = Math.max(0, year.actualFreeCashCents - year.baseForecastFreeCashCents);
    return total + Math.round(excess * share);
  }, 0);
}

/** Split a fixed contribution across the agreed per-year profile. */
export function buildPaymentSchedule(
  yearlyFixedCents: readonly number[],
  performanceCents: number,
  options: { performancePaidInFinalYear?: boolean } = {},
): Array<{ yearNumber: number; fixedCents: number; performanceCents: number; totalCents: number }> {
  const payInFinal = options.performancePaidInFinalYear ?? true;
  return yearlyFixedCents.map((fixed, index) => {
    const isFinal = index === yearlyFixedCents.length - 1;
    const perf = payInFinal ? (isFinal ? performanceCents : 0) : Math.round(performanceCents / yearlyFixedCents.length);
    return { yearNumber: index + 1, fixedCents: fixed, performanceCents: perf, totalCents: fixed + perf };
  });
}
