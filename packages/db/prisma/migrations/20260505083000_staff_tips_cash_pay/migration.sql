-- Staff beta payroll additions: cash-paid timesheets and simple tips runs.
ALTER TABLE "Timesheet"
  ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'XERO',
  ADD COLUMN "cashPaidAt" TIMESTAMP(3),
  ADD COLUMN "cashPaidById" TEXT,
  ADD COLUMN "cashPaymentNotes" TEXT;

CREATE INDEX "Timesheet_paymentMethod_workDate_idx" ON "Timesheet"("paymentMethod", "workDate");

CREATE TABLE "StaffTipCashEntry" (
  "id" TEXT NOT NULL,
  "venue" TEXT NOT NULL,
  "serviceDate" TIMESTAMP(3) NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StaffTipCashEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffTipCashEntry_venue_serviceDate_key" ON "StaffTipCashEntry"("venue", "serviceDate");
CREATE INDEX "StaffTipCashEntry_serviceDate_idx" ON "StaffTipCashEntry"("serviceDate");

CREATE TABLE "StaffTipPaymentRun" (
  "id" TEXT NOT NULL,
  "venue" TEXT NOT NULL,
  "weekStart" TIMESTAMP(3) NOT NULL,
  "weekEnd" TIMESTAMP(3) NOT NULL,
  "tipPoolCents" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PAID',
  "notes" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StaffTipPaymentRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffTipPaymentRun_venue_weekStart_weekEnd_idx" ON "StaffTipPaymentRun"("venue", "weekStart", "weekEnd");

CREATE TABLE "StaffTipPaymentRunLine" (
  "id" TEXT NOT NULL,
  "paymentRunId" TEXT NOT NULL,
  "staffProfileId" TEXT NOT NULL,
  "hours" DOUBLE PRECISION NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StaffTipPaymentRunLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffTipPaymentRunLine_staffProfileId_idx" ON "StaffTipPaymentRunLine"("staffProfileId");
CREATE INDEX "StaffTipPaymentRunLine_paymentRunId_idx" ON "StaffTipPaymentRunLine"("paymentRunId");

ALTER TABLE "StaffTipPaymentRunLine"
  ADD CONSTRAINT "StaffTipPaymentRunLine_paymentRunId_fkey"
  FOREIGN KEY ("paymentRunId") REFERENCES "StaffTipPaymentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StaffTipPaymentRunLine"
  ADD CONSTRAINT "StaffTipPaymentRunLine_staffProfileId_fkey"
  FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
