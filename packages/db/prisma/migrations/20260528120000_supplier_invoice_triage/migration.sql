-- Supplier invoice triage workflow.
--
-- Single-line invoices from suppliers are often sales-only items the
-- stock workstation doesn't care about (e.g. an event-services bill).
-- We split the unmatched bucket into two invoice-level decisions:
--   NO_ITEM       -> not stock-relevant; hidden from workstation, deletable
--   NEEDS_REVIEW  -> assigned to a manager for review; stays in queue
-- Default PENDING means no triage decision yet.

ALTER TABLE "SupplierInvoice"
  ADD COLUMN "triageStatus"             TEXT        NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "triagedAt"                TIMESTAMP(3),
  ADD COLUMN "triagedByStaffProfileId"  TEXT,
  ADD COLUMN "assignedToStaffProfileId" TEXT,
  ADD COLUMN "triageNotes"              TEXT;

CREATE INDEX "SupplierInvoice_triageStatus_idx"
  ON "SupplierInvoice"("triageStatus");

CREATE INDEX "SupplierInvoice_assignedToStaffProfileId_idx"
  ON "SupplierInvoice"("assignedToStaffProfileId");

ALTER TABLE "SupplierInvoice"
  ADD CONSTRAINT "SupplierInvoice_triagedByStaffProfileId_fkey"
    FOREIGN KEY ("triagedByStaffProfileId") REFERENCES "StaffProfile"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "SupplierInvoice_assignedToStaffProfileId_fkey"
    FOREIGN KEY ("assignedToStaffProfileId") REFERENCES "StaffProfile"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
