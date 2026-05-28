-- Reservation card-on-file for no-show protection (task #2).
-- Pattern: Stripe SetupIntent captures the card during booking but
-- does NOT charge; if the guest no-shows the manager triggers an
-- off-session PaymentIntent against the saved payment method.
--
-- See docs/research note Ester. We deliberately keep last4 + brand
-- locally so the manager UI can show "Visa ending 4242" without
-- another Stripe round trip.

ALTER TABLE "ReserveReservation"
  ADD COLUMN "stripeCustomerId"          TEXT,
  ADD COLUMN "stripeSetupIntentId"       TEXT,
  ADD COLUMN "stripePaymentMethodId"     TEXT,
  ADD COLUMN "stripePaymentMethodBrand"  TEXT,
  ADD COLUMN "stripePaymentMethodLast4"  TEXT,
  ADD COLUMN "noShowFeeAmountCents"      INTEGER,
  ADD COLUMN "noShowFeeChargedAt"        TIMESTAMP(3),
  ADD COLUMN "noShowFeePaymentIntentId"  TEXT,
  ADD COLUMN "noShowFeeError"            TEXT;

CREATE INDEX "ReserveReservation_stripeCustomerId_idx"
  ON "ReserveReservation"("stripeCustomerId")
  WHERE "stripeCustomerId" IS NOT NULL;
