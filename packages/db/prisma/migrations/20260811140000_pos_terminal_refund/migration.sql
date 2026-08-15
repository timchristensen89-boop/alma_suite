-- Refunds pushed back to a Square Terminal. Same shape as the checkout table,
-- including the latch that stops a repeated poll crediting the bill twice.

CREATE TABLE "PosTerminalRefund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "squarePaymentId" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "refundPaymentId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosTerminalRefund_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PosTerminalRefund_orderId_idx" ON "PosTerminalRefund"("orderId");

ALTER TABLE "PosTerminalRefund" ADD CONSTRAINT "PosTerminalRefund_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "PosOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosTerminalRefund" ADD CONSTRAINT "PosTerminalRefund_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "PosTerminalDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
