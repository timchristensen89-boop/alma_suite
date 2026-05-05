-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('STOCKTAKE_ADJUSTMENT');

-- AlterTable
ALTER TABLE "Stocktake" ADD COLUMN "appliedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "movementType" "InventoryMovementType" NOT NULL,
    "quantityDelta" DOUBLE PRECISION NOT NULL,
    "quantityBefore" DOUBLE PRECISION NOT NULL,
    "quantityAfter" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "sourceStocktakeId" TEXT,
    "sourceStocktakeLineId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_sourceStocktakeLineId_key" ON "InventoryMovement"("sourceStocktakeLineId");

-- CreateIndex
CREATE INDEX "InventoryMovement_itemId_createdAt_idx" ON "InventoryMovement"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_movementType_idx" ON "InventoryMovement"("movementType");

-- CreateIndex
CREATE INDEX "InventoryMovement_sourceStocktakeId_idx" ON "InventoryMovement"("sourceStocktakeId");

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_sourceStocktakeId_fkey" FOREIGN KEY ("sourceStocktakeId") REFERENCES "Stocktake"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_sourceStocktakeLineId_fkey" FOREIGN KEY ("sourceStocktakeLineId") REFERENCES "StocktakeLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
