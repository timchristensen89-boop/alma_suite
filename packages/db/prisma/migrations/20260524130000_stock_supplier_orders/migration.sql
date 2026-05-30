-- Stock supplier order workflow.
CREATE TABLE "StockSupplierOrder" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT,
    "orderedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "deliveryCheckId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockSupplierOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockSupplierOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "estimatedUnitCostCents" INTEGER,
    "notes" TEXT,
    "sourceReorderNoticeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockSupplierOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockSupplierOrder_venue_status_idx" ON "StockSupplierOrder"("venue", "status");
CREATE INDEX "StockSupplierOrder_supplierId_createdAt_idx" ON "StockSupplierOrder"("supplierId", "createdAt");
CREATE INDEX "StockSupplierOrder_deliveryCheckId_idx" ON "StockSupplierOrder"("deliveryCheckId");
CREATE INDEX "StockSupplierOrderItem_orderId_idx" ON "StockSupplierOrderItem"("orderId");
CREATE INDEX "StockSupplierOrderItem_stockItemId_idx" ON "StockSupplierOrderItem"("stockItemId");
CREATE INDEX "StockSupplierOrderItem_sourceReorderNoticeId_idx" ON "StockSupplierOrderItem"("sourceReorderNoticeId");

ALTER TABLE "StockSupplierOrder"
  ADD CONSTRAINT "StockSupplierOrder_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockSupplierOrder"
  ADD CONSTRAINT "StockSupplierOrder_deliveryCheckId_fkey"
  FOREIGN KEY ("deliveryCheckId") REFERENCES "StockDeliveryCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockSupplierOrderItem"
  ADD CONSTRAINT "StockSupplierOrderItem_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "StockSupplierOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockSupplierOrderItem"
  ADD CONSTRAINT "StockSupplierOrderItem_stockItemId_fkey"
  FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockSupplierOrderItem"
  ADD CONSTRAINT "StockSupplierOrderItem_sourceReorderNoticeId_fkey"
  FOREIGN KEY ("sourceReorderNoticeId") REFERENCES "StockReorderNotice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
