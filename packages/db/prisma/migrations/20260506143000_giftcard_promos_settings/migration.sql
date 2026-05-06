CREATE TYPE "GiftCardPromoDiscountType" AS ENUM ('PERCENT', 'FIXED_AMOUNT');

ALTER TABLE "AppSettings" ADD COLUMN "giftCardSettings" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "GiftCard"
  ADD COLUMN "discountCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "amountPaidCents" INTEGER,
  ADD COLUMN "promoCodeId" TEXT,
  ADD COLUMN "promoCodeSnapshot" TEXT,
  ADD COLUMN "testMode" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "GiftCardPromoCode" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT,
  "discountType" "GiftCardPromoDiscountType" NOT NULL,
  "percentOff" INTEGER,
  "amountOffCents" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "startsAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "maxRedemptions" INTEGER,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GiftCardPromoCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GiftCardPromoCode_code_key" ON "GiftCardPromoCode"("code");
CREATE INDEX "GiftCardPromoCode_isActive_idx" ON "GiftCardPromoCode"("isActive");
CREATE INDEX "GiftCardPromoCode_expiresAt_idx" ON "GiftCardPromoCode"("expiresAt");
CREATE INDEX "GiftCardPromoCode_createdAt_idx" ON "GiftCardPromoCode"("createdAt");
CREATE INDEX "GiftCard_promoCodeId_idx" ON "GiftCard"("promoCodeId");
CREATE INDEX "GiftCard_testMode_idx" ON "GiftCard"("testMode");

ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "GiftCardPromoCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
