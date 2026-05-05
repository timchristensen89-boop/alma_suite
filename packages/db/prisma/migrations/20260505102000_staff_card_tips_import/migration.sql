-- Source-agnostic card tips import. Control CSVs and future Square sync can both write here.
CREATE TABLE "StaffTipCardEntry" (
  "id" TEXT NOT NULL,
  "venue" TEXT NOT NULL,
  "serviceDate" TIMESTAMP(3) NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'control',
  "externalId" TEXT,
  "importKey" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StaffTipCardEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffTipCardEntry_importKey_key" ON "StaffTipCardEntry"("importKey");
CREATE INDEX "StaffTipCardEntry_serviceDate_idx" ON "StaffTipCardEntry"("serviceDate");
CREATE INDEX "StaffTipCardEntry_venue_serviceDate_idx" ON "StaffTipCardEntry"("venue", "serviceDate");
CREATE INDEX "StaffTipCardEntry_source_idx" ON "StaffTipCardEntry"("source");

