-- POS v4: audited adjustments, per-user homescreens, manual discounts.
CREATE TABLE "PosAdjustment" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "orderId" TEXT,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "itemName" TEXT,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PosAdjustment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PosAdjustment_venue_createdAt_idx" ON "PosAdjustment"("venue", "createdAt");
CREATE INDEX "PosAdjustment_kind_idx" ON "PosAdjustment"("kind");

CREATE TABLE "PosHomescreen" (
    "id" TEXT NOT NULL,
    "userKey" TEXT NOT NULL,
    "buttons" JSONB NOT NULL,
    "pins" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PosHomescreen_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PosHomescreen_userKey_key" ON "PosHomescreen"("userKey");

ALTER TABLE "PosOrder" ADD COLUMN "manualDiscountCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PosOrder" ADD COLUMN "manualDiscountLabel" TEXT;
