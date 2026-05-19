-- CreateTable
CREATE TABLE "StaffHrRecord" (
    "id" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STORED',
    "issueDate" TIMESTAMP(3),
    "effectiveDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "followUpDate" TIMESTAMP(3),
    "reason" TEXT,
    "oldRateCents" INTEGER,
    "newRateCents" INTEGER,
    "documentName" TEXT,
    "documentUrl" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffHrRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffHrRecord_staffProfileId_recordType_idx" ON "StaffHrRecord"("staffProfileId", "recordType");

-- CreateIndex
CREATE INDEX "StaffHrRecord_recordType_status_idx" ON "StaffHrRecord"("recordType", "status");

-- CreateIndex
CREATE INDEX "StaffHrRecord_expiryDate_idx" ON "StaffHrRecord"("expiryDate");

-- CreateIndex
CREATE INDEX "StaffHrRecord_followUpDate_idx" ON "StaffHrRecord"("followUpDate");

-- AddForeignKey
ALTER TABLE "StaffHrRecord" ADD CONSTRAINT "StaffHrRecord_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
