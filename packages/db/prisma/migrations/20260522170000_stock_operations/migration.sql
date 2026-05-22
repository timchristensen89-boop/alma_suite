ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'WASTAGE';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'DELIVERY_RECEIPT';

CREATE TABLE "StockWastageRecord" (
  "id" TEXT NOT NULL,
  "stockItemId" TEXT NOT NULL,
  "venue" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "note" TEXT,
  "wastedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedById" TEXT,
  "costImpactCents" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'RECORDED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockWastageRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockDeliveryCheck" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT,
  "supplierName" TEXT NOT NULL,
  "venue" TEXT NOT NULL,
  "invoiceNumber" TEXT,
  "deliveryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "invoiceReference" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "createdById" TEXT,
  "completedAt" TIMESTAMP(3),
  "completedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockDeliveryCheck_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockDeliveryCheckItem" (
  "id" TEXT NOT NULL,
  "deliveryCheckId" TEXT NOT NULL,
  "stockItemId" TEXT,
  "description" TEXT NOT NULL,
  "expectedQuantity" DOUBLE PRECISION,
  "receivedQuantity" DOUBLE PRECISION,
  "unit" TEXT,
  "checked" BOOLEAN NOT NULL DEFAULT false,
  "discrepancy" BOOLEAN NOT NULL DEFAULT false,
  "discrepancyReason" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockDeliveryCheckItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockReorderNotice" (
  "id" TEXT NOT NULL,
  "stockItemId" TEXT NOT NULL,
  "venue" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "currentOnHand" DOUBLE PRECISION,
  "parLevel" DOUBLE PRECISION,
  "reorderPoint" DOUBLE PRECISION,
  "reorderQuantity" DOUBLE PRECISION,
  "unit" TEXT,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "dismissedAt" TIMESTAMP(3),
  "dismissedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockReorderNotice_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InventoryMovement" ADD COLUMN "sourceWastageId" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "sourceDeliveryCheckItemId" TEXT;

CREATE INDEX "StockWastageRecord_venue_wastedAt_idx" ON "StockWastageRecord"("venue", "wastedAt");
CREATE INDEX "StockWastageRecord_stockItemId_wastedAt_idx" ON "StockWastageRecord"("stockItemId", "wastedAt");
CREATE INDEX "StockWastageRecord_reason_idx" ON "StockWastageRecord"("reason");

CREATE INDEX "StockDeliveryCheck_venue_status_idx" ON "StockDeliveryCheck"("venue", "status");
CREATE INDEX "StockDeliveryCheck_supplierId_deliveryDate_idx" ON "StockDeliveryCheck"("supplierId", "deliveryDate");
CREATE INDEX "StockDeliveryCheck_invoiceNumber_idx" ON "StockDeliveryCheck"("invoiceNumber");

CREATE INDEX "StockDeliveryCheckItem_deliveryCheckId_idx" ON "StockDeliveryCheckItem"("deliveryCheckId");
CREATE INDEX "StockDeliveryCheckItem_stockItemId_idx" ON "StockDeliveryCheckItem"("stockItemId");
CREATE INDEX "StockDeliveryCheckItem_discrepancy_idx" ON "StockDeliveryCheckItem"("discrepancy");

CREATE INDEX "StockReorderNotice_venue_status_idx" ON "StockReorderNotice"("venue", "status");
CREATE INDEX "StockReorderNotice_venue_stockItemId_status_idx" ON "StockReorderNotice"("venue", "stockItemId", "status");
CREATE INDEX "StockReorderNotice_stockItemId_idx" ON "StockReorderNotice"("stockItemId");

CREATE INDEX "InventoryMovement_sourceWastageId_idx" ON "InventoryMovement"("sourceWastageId");
CREATE INDEX "InventoryMovement_sourceDeliveryCheckItemId_idx" ON "InventoryMovement"("sourceDeliveryCheckItemId");

ALTER TABLE "StockWastageRecord" ADD CONSTRAINT "StockWastageRecord_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockDeliveryCheck" ADD CONSTRAINT "StockDeliveryCheck_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockDeliveryCheckItem" ADD CONSTRAINT "StockDeliveryCheckItem_deliveryCheckId_fkey" FOREIGN KEY ("deliveryCheckId") REFERENCES "StockDeliveryCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockDeliveryCheckItem" ADD CONSTRAINT "StockDeliveryCheckItem_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockReorderNotice" ADD CONSTRAINT "StockReorderNotice_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_sourceWastageId_fkey" FOREIGN KEY ("sourceWastageId") REFERENCES "StockWastageRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_sourceDeliveryCheckItemId_fkey" FOREIGN KEY ("sourceDeliveryCheckItemId") REFERENCES "StockDeliveryCheckItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
