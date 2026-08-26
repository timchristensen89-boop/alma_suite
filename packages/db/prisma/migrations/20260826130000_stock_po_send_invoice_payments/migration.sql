-- Purchasing loop, closed at both ends.
--
-- PurchaseOrder: "send" now actually emails the supplier, so the order keeps
-- a record of what went where (audit, resend, "did they get it").
--
-- SupplierInvoice: payment matching. `status` is whatever the source system
-- (Xero) said and is never interpreted; these new fields are ours —
-- UNPAID | PARTIALLY_PAID | PAID with the amount, date and reference.

-- AlterTable
ALTER TABLE "PurchaseOrder"
  ADD COLUMN "sentAt" TIMESTAMP(3),
  ADD COLUMN "sentTo" TEXT,
  ADD COLUMN "sentSubject" TEXT,
  ADD COLUMN "sentBody" TEXT;

-- AlterTable
ALTER TABLE "SupplierInvoice"
  ADD COLUMN "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "paymentReference" TEXT,
  ADD COLUMN "paymentNotes" TEXT;

-- CreateIndex
CREATE INDEX "SupplierInvoice_paymentStatus_idx" ON "SupplierInvoice"("paymentStatus");

-- Backfill: Xero-synced bills carry Xero's own status, and PAID there means
-- the money has already left the account. Seed the new field from it so
-- nobody has to re-mark hundreds of historical bills by hand. AUTHORISED
-- (approved, not yet paid) correctly stays UNPAID.
UPDATE "SupplierInvoice"
SET "paymentStatus" = 'PAID',
    "amountPaidCents" = "totalCents",
    "paidAt" = COALESCE("invoiceDate", "importedAt")
WHERE upper("status") = 'PAID';
