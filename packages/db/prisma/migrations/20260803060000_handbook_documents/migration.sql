-- Files that belong to the staff handbook: policy PDFs, floor plans, photos of
-- how the pass should look. The handbook has been a JSON blob of text with no
-- way to attach anything, so every policy document lived in somebody's email.
CREATE TABLE "HandbookDocument" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "data" BYTEA NOT NULL,
  "venue" TEXT,
  "sendOnOnboarding" BOOLEAN NOT NULL DEFAULT false,
  "position" INTEGER NOT NULL DEFAULT 0,
  "uploadedByStaffId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HandbookDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HandbookDocument_venue_idx" ON "HandbookDocument"("venue");
CREATE INDEX "HandbookDocument_sendOnOnboarding_idx" ON "HandbookDocument"("sendOnOnboarding");
