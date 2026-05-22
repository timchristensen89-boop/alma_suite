CREATE TABLE "StaffDocumentReview" (
  "id" TEXT NOT NULL,
  "recordType" "StaffRecordType" NOT NULL DEFAULT 'RSA',
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  "source" TEXT NOT NULL DEFAULT 'deputy-document-import',
  "sourceFileName" TEXT NOT NULL,
  "sourceFileHash" TEXT NOT NULL,
  "candidateName" TEXT,
  "candidateStaffIds" JSONB NOT NULL DEFAULT '[]',
  "reviewReason" TEXT NOT NULL,
  "documentName" TEXT,
  "documentUrl" TEXT,
  "notes" TEXT,
  "resolvedStaffProfileId" TEXT,
  "resolvedRecordId" TEXT,
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StaffDocumentReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffDocumentReview_source_sourceFileHash_key" ON "StaffDocumentReview"("source", "sourceFileHash");
CREATE INDEX "StaffDocumentReview_status_createdAt_idx" ON "StaffDocumentReview"("status", "createdAt");
CREATE INDEX "StaffDocumentReview_recordType_status_idx" ON "StaffDocumentReview"("recordType", "status");
