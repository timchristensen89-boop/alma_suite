-- Tip review beta: store manager adjustments and final paid line details.
ALTER TABLE "StaffTipPaymentRunLine"
  ADD COLUMN "baseAmountCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "adjustmentCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "excluded" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "notes" TEXT;

