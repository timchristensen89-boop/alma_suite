-- CreateTable
CREATE TABLE "StaffTipManualHoursEntry" (
    "id" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffTipManualHoursEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffTipManualHoursEntry_staffProfileId_venue_weekStart_key" ON "StaffTipManualHoursEntry"("staffProfileId", "venue", "weekStart");

-- CreateIndex
CREATE INDEX "StaffTipManualHoursEntry_staffProfileId_idx" ON "StaffTipManualHoursEntry"("staffProfileId");

-- CreateIndex
CREATE INDEX "StaffTipManualHoursEntry_venue_weekStart_idx" ON "StaffTipManualHoursEntry"("venue", "weekStart");

-- AddForeignKey
ALTER TABLE "StaffTipManualHoursEntry" ADD CONSTRAINT "StaffTipManualHoursEntry_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
