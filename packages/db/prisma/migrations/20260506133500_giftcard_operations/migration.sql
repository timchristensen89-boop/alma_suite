ALTER TABLE "GiftCard" ADD COLUMN "emailedAt" TIMESTAMP(3);
ALTER TABLE "GiftCard" ADD COLUMN "emailError" TEXT;
ALTER TABLE "GiftCard" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "GiftCard" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "GiftCard" ADD COLUMN "refundNote" TEXT;
ALTER TABLE "GiftCard" ADD COLUMN "cancelledById" TEXT;
