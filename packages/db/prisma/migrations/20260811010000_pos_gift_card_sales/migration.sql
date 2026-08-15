-- Selling gift cards through the bill, so the money lands in the till, the
-- drawer and the day's takings like any other tender.
ALTER TABLE "PosOrderLine" ADD COLUMN "isGiftCard" BOOLEAN NOT NULL DEFAULT false;

-- The sale record is the source of truth: setLines deletes and recreates
-- every line, so the voucher cannot live on the line alone.
CREATE TABLE "PosGiftCardSale" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "requestedCode" TEXT,
  "recipientName" TEXT,
  "recipientEmail" TEXT,
  "issuedCode" TEXT,
  "issuedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PosGiftCardSale_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PosGiftCardSale_orderId_idx" ON "PosGiftCardSale"("orderId");
ALTER TABLE "PosGiftCardSale" ADD CONSTRAINT "PosGiftCardSale_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "PosOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
