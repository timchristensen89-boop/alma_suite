-- Inter-venue stock transfers (manager/admin), adjusting per-venue on-hand.

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "fromVenue" TEXT NOT NULL,
    "toVenue" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "notes" TEXT,
    "createdByName" TEXT,
    "createdByUserId" TEXT,
    "fromOnHandAfter" DOUBLE PRECISION,
    "toOnHandAfter" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockTransfer_stockItemId_createdAt_idx" ON "StockTransfer"("stockItemId", "createdAt");

-- CreateIndex
CREATE INDEX "StockTransfer_fromVenue_createdAt_idx" ON "StockTransfer"("fromVenue", "createdAt");

-- CreateIndex
CREATE INDEX "StockTransfer_toVenue_createdAt_idx" ON "StockTransfer"("toVenue", "createdAt");

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
