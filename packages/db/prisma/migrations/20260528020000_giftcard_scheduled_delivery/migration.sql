-- GiftCard.scheduledDeliveryAt: when the buyer picked "Schedule it" on
-- the buy page (e.g. for a birthday). NULL means send immediately on
-- Stripe completion (existing behaviour). When set + in the future,
-- the Stripe webhook skips sendGiftCardEmail and the
-- /jobs/gift-cards/drain Cloud Scheduler endpoint sends it when the
-- time comes.

ALTER TABLE "GiftCard" ADD COLUMN "scheduledDeliveryAt" TIMESTAMP(3);

CREATE INDEX "GiftCard_scheduledDeliveryAt_idx"
  ON "GiftCard"("scheduledDeliveryAt")
  WHERE "scheduledDeliveryAt" IS NOT NULL AND "emailedAt" IS NULL;
