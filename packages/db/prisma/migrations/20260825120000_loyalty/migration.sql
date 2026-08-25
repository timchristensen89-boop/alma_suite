-- Loyalty: points on spend, redeemable as credit at the register.
-- Members ARE guests — loyalty fields live on ReserveGuest so points, visits
-- and spend share one identity. loyaltyPoints is a cached balance; the
-- ledger is the audit trail and always moves in the same transaction.
ALTER TABLE "ReserveGuest" ADD COLUMN "loyaltyCode" TEXT;
ALTER TABLE "ReserveGuest" ADD COLUMN "loyaltyJoinedAt" TIMESTAMP(3);
ALTER TABLE "ReserveGuest" ADD COLUMN "loyaltyPoints" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "ReserveGuest_loyaltyCode_key" ON "ReserveGuest"("loyaltyCode");

CREATE TABLE "LoyaltyLedgerEntry" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "venue" TEXT,
    "kind" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "orderCents" INTEGER,
    "posOrderId" TEXT,
    "earnKey" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoyaltyLedgerEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LoyaltyLedgerEntry_earnKey_key" ON "LoyaltyLedgerEntry"("earnKey");
CREATE INDEX "LoyaltyLedgerEntry_guestId_createdAt_idx" ON "LoyaltyLedgerEntry"("guestId", "createdAt");
CREATE INDEX "LoyaltyLedgerEntry_posOrderId_idx" ON "LoyaltyLedgerEntry"("posOrderId");
ALTER TABLE "LoyaltyLedgerEntry" ADD CONSTRAINT "LoyaltyLedgerEntry_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "ReserveGuest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AppSettings" ADD COLUMN "loyaltySettings" JSONB NOT NULL DEFAULT '{}';
