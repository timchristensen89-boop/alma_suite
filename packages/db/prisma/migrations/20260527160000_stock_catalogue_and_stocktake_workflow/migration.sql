-- Stock catalogue + stocktake workflow upgrades for Loaded replacement.
--
-- 1. StockItem gains countUnit, conversionFactor, countArea, latestCostCents,
--    latestCostAt. Older avgCostCents stays for compatibility.
-- 2. StocktakeStatus gains REVIEWED, LOCKED, REOPENED. IN_PROGRESS is kept
--    so existing rows don't need a backfill — IN_PROGRESS aliases DRAFT.
-- 3. Stocktake gains lockedAt, lockedByUserId, reopenedAt, reopenedByUserId,
--    reopenReason, importSource columns.

-- StockItem catalogue fields
ALTER TABLE "StockItem"
  ADD COLUMN "countUnit" TEXT,
  ADD COLUMN "conversionFactor" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN "countArea" TEXT,
  ADD COLUMN "latestCostCents" INTEGER,
  ADD COLUMN "latestCostAt" TIMESTAMP(3);

CREATE INDEX "StockItem_countArea_idx" ON "StockItem"("countArea");

-- StocktakeStatus enum upgrade (PostgreSQL allows adding values to enums
-- without rewriting rows, as long as we don't drop the existing ones).
ALTER TYPE "StocktakeStatus" ADD VALUE IF NOT EXISTS 'REVIEWED';
ALTER TYPE "StocktakeStatus" ADD VALUE IF NOT EXISTS 'LOCKED';
ALTER TYPE "StocktakeStatus" ADD VALUE IF NOT EXISTS 'REOPENED';

-- Stocktake workflow columns
ALTER TABLE "Stocktake"
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "lockedByUserId" TEXT,
  ADD COLUMN "reopenedAt" TIMESTAMP(3),
  ADD COLUMN "reopenedByUserId" TEXT,
  ADD COLUMN "reopenReason" TEXT,
  ADD COLUMN "importSource" TEXT;

CREATE INDEX "Stocktake_lockedAt_idx" ON "Stocktake"("lockedAt");
