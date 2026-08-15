-- Guest QR rounds held until Square confirms payment. Nothing reaches the
-- table's bill or the kitchen until then.

CREATE TABLE "PosQrPendingOrder" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "tableLabel" TEXT NOT NULL,
    "guestName" TEXT,
    "notes" TEXT,
    "dietary" JSONB NOT NULL DEFAULT '[]',
    "lines" JSONB NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "squarePaymentLinkId" TEXT,
    "squareOrderId" TEXT,
    "checkoutUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "posOrderId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosQrPendingOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PosQrPendingOrder_status_createdAt_idx" ON "PosQrPendingOrder"("status", "createdAt");
CREATE INDEX "PosQrPendingOrder_venue_tableLabel_idx" ON "PosQrPendingOrder"("venue", "tableLabel");
