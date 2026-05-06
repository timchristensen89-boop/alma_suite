ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'STOCKTAKE_CORRECTION';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'STOCKTAKE_REVERSAL';

DROP INDEX IF EXISTS "InventoryMovement_sourceStocktakeLineId_key";

CREATE INDEX IF NOT EXISTS "InventoryMovement_sourceStocktakeLineId_idx" ON "InventoryMovement"("sourceStocktakeLineId");
