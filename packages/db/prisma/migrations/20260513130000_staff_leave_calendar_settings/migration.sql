-- Add staff defaults to settings and a scoped leave request register.
ALTER TABLE "AppSettings"
ADD COLUMN "staffDefaults" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "StaffLeaveRequest" (
    "id" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "managerNote" TEXT,
    "requestedByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffLeaveRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffLeaveRequest_staffProfileId_startDate_idx"
ON "StaffLeaveRequest"("staffProfileId", "startDate");

CREATE INDEX "StaffLeaveRequest_status_startDate_idx"
ON "StaffLeaveRequest"("status", "startDate");

CREATE INDEX "StaffLeaveRequest_startDate_endDate_idx"
ON "StaffLeaveRequest"("startDate", "endDate");

ALTER TABLE "StaffLeaveRequest"
ADD CONSTRAINT "StaffLeaveRequest_staffProfileId_fkey"
FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
