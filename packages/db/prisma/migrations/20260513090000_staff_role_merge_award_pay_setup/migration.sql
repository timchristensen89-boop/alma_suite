ALTER TABLE "StaffProfile" ADD COLUMN "mergedIntoStaffProfileId" TEXT;
ALTER TABLE "StaffProfile" ADD COLUMN "mergedAt" TIMESTAMP(3);
ALTER TABLE "StaffProfile" ADD COLUMN "mergedByUserId" TEXT;

CREATE TABLE "StaffPayProfile" (
    "id" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "awardCode" TEXT NOT NULL,
    "awardName" TEXT NOT NULL,
    "awardClassification" TEXT NOT NULL,
    "employmentType" TEXT NOT NULL,
    "payMode" TEXT NOT NULL DEFAULT 'AWARD',
    "awardRateSource" TEXT NOT NULL,
    "awardRateEffectiveFrom" TIMESTAMP(3) NOT NULL,
    "payGuidePublishedAt" TIMESTAMP(3) NOT NULL,
    "rateSetVersion" TEXT NOT NULL,
    "ordinaryHourlyRateCents" INTEGER NOT NULL,
    "casualLoadedHourlyRateCents" INTEGER,
    "manualFullTimePayAmountCents" INTEGER,
    "manualFullTimePayFrequency" TEXT,
    "manualFullTimePayNote" TEXT,
    "payUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payUpdatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffPayProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StaffManagementEvent" (
    "id" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffManagementEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffPayProfile_staffProfileId_key" ON "StaffPayProfile"("staffProfileId");
CREATE INDEX "StaffPayProfile_awardCode_awardClassification_idx" ON "StaffPayProfile"("awardCode", "awardClassification");
CREATE INDEX "StaffPayProfile_payUpdatedAt_idx" ON "StaffPayProfile"("payUpdatedAt");
CREATE INDEX "StaffManagementEvent_staffProfileId_createdAt_idx" ON "StaffManagementEvent"("staffProfileId", "createdAt");
CREATE INDEX "StaffManagementEvent_eventType_createdAt_idx" ON "StaffManagementEvent"("eventType", "createdAt");
CREATE INDEX "StaffProfile_mergedIntoStaffProfileId_idx" ON "StaffProfile"("mergedIntoStaffProfileId");

ALTER TABLE "StaffPayProfile" ADD CONSTRAINT "StaffPayProfile_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffManagementEvent" ADD CONSTRAINT "StaffManagementEvent_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
