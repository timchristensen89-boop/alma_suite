-- Idempotency key for timesheet rows imported from Xero Payroll.
ALTER TABLE "Timesheet" ADD COLUMN "xeroImportKey" TEXT;
CREATE UNIQUE INDEX "Timesheet_xeroImportKey_key" ON "Timesheet"("xeroImportKey");
