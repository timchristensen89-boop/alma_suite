// Square payout ↔ Xero bank deposit reconciliation.
//
// Why this matters for a cash forecast: sales happen on one date and the money
// lands in the bank on another. The brief is explicit — do not infer bank
// deposits from sales dates when payout data exists. This module ties an
// actual Square payout to the actual Xero bank line, so the forecast starts
// from money that genuinely arrived.
//
// Matching is deliberately conservative. An unmatched payout is surfaced as a
// data-quality issue rather than guessed at, because a wrong match silently
// misstates the bank position.

export interface PayoutLike {
  id: string;
  netPayoutCents: number;
  /** When Square says the money should land. Preferred for matching. */
  arrivalDate?: Date | null;
  payoutDate: Date;
  destinationAccount?: string | null;
}

export interface BankTransactionLike {
  id: string;
  /** Signed: positive is a receipt. */
  amountCents: number;
  txnDate: Date;
  bankAccountName?: string | null;
  reference?: string | null;
}

export interface MatchOptions {
  /** How many days either side of arrival to consider. Settlement drifts. */
  toleranceDays?: number;
  /** Cents of difference tolerated (bank fees posted separately, rounding). */
  amountToleranceCents?: number;
}

export interface PayoutMatch {
  payoutId: string;
  bankTransactionId: string;
  dayDelta: number;
  amountDeltaCents: number;
  confidence: "EXACT" | "CLOSE";
}

export interface ReconciliationResult {
  matches: PayoutMatch[];
  unmatchedPayoutIds: string[];
  /** Bank receipts with no payout — other income, transfers, funding. */
  unmatchedBankTransactionIds: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const dayDiff = (a: Date, b: Date): number =>
  Math.round((Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()) -
    Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())) / DAY_MS);

/**
 * Greedy best-first matching: every candidate pair is scored, then the
 * strongest pairs are taken first, each payout and bank line used at most
 * once. Greedy on a sorted score list is stable and explainable — which
 * matters more here than the marginal gain of an optimal assignment.
 */
export function reconcilePayouts(
  payouts: PayoutLike[],
  bankTransactions: BankTransactionLike[],
  options: MatchOptions = {},
): ReconciliationResult {
  const toleranceDays = options.toleranceDays ?? 3;
  const amountTolerance = Math.max(0, options.amountToleranceCents ?? 0);

  // Only receipts can be a payout landing.
  const receipts = bankTransactions.filter((txn) => txn.amountCents > 0);

  type Candidate = { payout: PayoutLike; txn: BankTransactionLike; dayDelta: number; amountDelta: number; score: number };
  const candidates: Candidate[] = [];

  for (const payout of payouts) {
    const expectedDate = payout.arrivalDate ?? payout.payoutDate;
    for (const txn of receipts) {
      const amountDelta = Math.abs(txn.amountCents - payout.netPayoutCents);
      if (amountDelta > amountTolerance) continue;
      const delta = dayDiff(txn.txnDate, expectedDate);
      if (Math.abs(delta) > toleranceDays) continue;
      // Prefer exact amounts, then closeness in time.
      const score = amountDelta * 1000 + Math.abs(delta);
      candidates.push({ payout, txn, dayDelta: delta, amountDelta, score });
    }
  }

  candidates.sort((a, b) => a.score - b.score || a.payout.id.localeCompare(b.payout.id));

  const usedPayouts = new Set<string>();
  const usedTxns = new Set<string>();
  const matches: PayoutMatch[] = [];

  for (const candidate of candidates) {
    if (usedPayouts.has(candidate.payout.id) || usedTxns.has(candidate.txn.id)) continue;
    usedPayouts.add(candidate.payout.id);
    usedTxns.add(candidate.txn.id);
    matches.push({
      payoutId: candidate.payout.id,
      bankTransactionId: candidate.txn.id,
      dayDelta: candidate.dayDelta,
      amountDeltaCents: candidate.amountDelta,
      confidence: candidate.amountDelta === 0 && candidate.dayDelta === 0 ? "EXACT" : "CLOSE",
    });
  }

  return {
    matches,
    unmatchedPayoutIds: payouts.filter((p) => !usedPayouts.has(p.id)).map((p) => p.id),
    unmatchedBankTransactionIds: receipts.filter((t) => !usedTxns.has(t.id)).map((t) => t.id),
  };
}

/**
 * Expected cash arrival for the forecast.
 *
 * Uses the actual arrival date when Square supplies one. Otherwise applies the
 * observed median settlement lag rather than assuming same-day, and says which
 * it did so the UI can label the figure honestly.
 */
export function expectedArrival(
  payout: PayoutLike,
  medianSettlementLagDays: number,
): { date: Date; basis: "ACTUAL_ARRIVAL" | "ESTIMATED_LAG" } {
  if (payout.arrivalDate) return { date: payout.arrivalDate, basis: "ACTUAL_ARRIVAL" };
  const estimated = new Date(payout.payoutDate.getTime() + Math.round(medianSettlementLagDays) * DAY_MS);
  return { date: estimated, basis: "ESTIMATED_LAG" };
}

/** Median whole-day lag between payout date and actual arrival. */
export function medianSettlementLagDays(payouts: PayoutLike[]): number {
  const lags = payouts
    .filter((p) => p.arrivalDate)
    .map((p) => dayDiff(p.arrivalDate as Date, p.payoutDate))
    .filter((lag) => lag >= 0)
    .sort((a, b) => a - b);
  if (lags.length === 0) return 1; // Square's common next-business-day default
  const mid = Math.floor(lags.length / 2);
  return lags.length % 2 === 1 ? (lags[mid] as number) : Math.round((((lags[mid - 1] as number) + (lags[mid] as number)) / 2));
}
