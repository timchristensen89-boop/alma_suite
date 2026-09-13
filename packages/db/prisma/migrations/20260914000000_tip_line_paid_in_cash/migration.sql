-- A tip line paid by hand: the amount stands in the run and in the person's
-- own tip history, and only the ABA export leaves it out. Excluding someone
-- is the other way out of the bank file, but that hands their share back to
-- the pool; this does not.
ALTER TABLE "StaffTipPaymentRunLine" ADD COLUMN IF NOT EXISTS "paidInCash" BOOLEAN NOT NULL DEFAULT false;
