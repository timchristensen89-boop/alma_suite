ALTER TYPE "StaffRecordStatus" ADD VALUE 'REQUESTED';
ALTER TYPE "StaffRecordStatus" ADD VALUE 'UPLOADED';
ALTER TYPE "StaffRecordStatus" ADD VALUE 'REJECTED';

ALTER TABLE "StaffComplianceRecord"
  ADD COLUMN "dueAt" TIMESTAMP(3),
  ADD COLUMN "requestedAt" TIMESTAMP(3),
  ADD COLUMN "requestedById" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "rejectedAt" TIMESTAMP(3),
  ADD COLUMN "rejectedById" TEXT,
  ADD COLUMN "rejectionReason" TEXT;

CREATE INDEX "StaffComplianceRecord_status_dueAt_idx" ON "StaffComplianceRecord"("status", "dueAt");
CREATE INDEX "StaffComplianceRecord_requestedById_idx" ON "StaffComplianceRecord"("requestedById");
