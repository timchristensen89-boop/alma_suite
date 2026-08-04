-- Counter sales: record how a gift card was sold and how it was paid for, so a
-- card handed over the bar reconciles against the venue's takings rather than
-- appearing from nowhere.
ALTER TABLE "GiftCard" ADD COLUMN "saleChannel" TEXT NOT NULL DEFAULT 'ONLINE';
ALTER TABLE "GiftCard" ADD COLUMN "tender" TEXT;
ALTER TABLE "GiftCard" ADD COLUMN "tenderReference" TEXT;
ALTER TABLE "GiftCard" ADD COLUMN "soldByStaffId" TEXT;

-- Everything that already carries a Stripe session was bought on the public
-- page and paid by Stripe; say so rather than leaving it null.
UPDATE "GiftCard" SET "tender" = 'STRIPE' WHERE "stripeCheckoutSessionId" IS NOT NULL;

CREATE INDEX "GiftCard_saleChannel_idx" ON "GiftCard"("saleChannel");
