-- Additive metadata for stocktake review/reporting. No existing balances or
-- stocktake rows are rewritten.
ALTER TABLE "Stocktake"
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "submittedByUserId" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedByUserId" TEXT;

CREATE INDEX "Stocktake_venue_status_idx" ON "Stocktake"("venue", "status");
CREATE INDEX "Stocktake_submittedAt_idx" ON "Stocktake"("submittedAt");
CREATE INDEX "Stocktake_reviewedAt_idx" ON "Stocktake"("reviewedAt");
