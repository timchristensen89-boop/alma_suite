-- Add editable Staff HR document templates. This is additive and does not alter existing HR records.
CREATE TABLE "StaffHrDocumentTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "body" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "optionalClauses" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffHrDocumentTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffHrDocumentTemplate_recordType_status_idx" ON "StaffHrDocumentTemplate"("recordType", "status");
CREATE INDEX "StaffHrDocumentTemplate_status_idx" ON "StaffHrDocumentTemplate"("status");
CREATE INDEX "StaffHrDocumentTemplate_updatedAt_idx" ON "StaffHrDocumentTemplate"("updatedAt");
