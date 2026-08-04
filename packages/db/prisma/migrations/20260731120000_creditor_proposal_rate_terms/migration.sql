-- Creditor proposals commit a RATE, not a dollar total.
--
-- The v5 Indicative Creditor Funding Proposal (30 Jul 2026, revised 31 Jul)
-- offers 10 cents in the dollar with a contingent further 5 cents, against the
-- admitted external pool. Its section 7 is explicit about why: "each
-- distribution recalculates automatically if the admitted pool changes, so no
-- renegotiation of the rate is required as claims are adjudicated."
--
-- Storing only fixedTotalCents loses that: every re-adjudication of the pool
-- would need a hand recalculation. These columns keep the rate as the term and
-- leave fixedTotalCents as a snapshot against the current pool estimate.
ALTER TABLE "fc_creditor_proposals" ADD COLUMN IF NOT EXISTS "baseCentsInDollar" DECIMAL(6,3);
ALTER TABLE "fc_creditor_proposals" ADD COLUMN IF NOT EXISTS "performanceCentsInDollar" DECIMAL(6,3);
ALTER TABLE "fc_creditor_proposals" ADD COLUMN IF NOT EXISTS "estimatedExternalPoolCents" INTEGER;
ALTER TABLE "fc_creditor_proposals" ADD COLUMN IF NOT EXISTS "yearShares" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "fc_creditor_proposals" ADD COLUMN IF NOT EXISTS "decemberShare" DECIMAL(6,3);
