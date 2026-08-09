ALTER TABLE "PosVenueSetting"
  ADD COLUMN "xeroTenantId" TEXT,
  ADD COLUMN "xeroSalesAccount" TEXT,
  ADD COLUMN "xeroTipsAccount" TEXT,
  ADD COLUMN "xeroCashAccount" TEXT,
  ADD COLUMN "xeroCardAccount" TEXT,
  ADD COLUMN "xeroGiftCardAccount" TEXT;

CREATE TABLE "PosXeroPost" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "detail" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PosXeroPost_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PosXeroPost_venue_serviceDate_key" ON "PosXeroPost"("venue", "serviceDate");
CREATE INDEX "PosXeroPost_serviceDate_idx" ON "PosXeroPost"("serviceDate");
