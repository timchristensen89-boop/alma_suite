-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'EXPORTED');

-- CreateTable
CREATE TABLE "Timesheet" (
    "id" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "rosterShiftId" TEXT,
    "venue" TEXT,
    "area" TEXT,
    "roleTitle" TEXT,
    "workDate" TIMESTAMP(3) NOT NULL,
    "clockInAt" TIMESTAMP(3) NOT NULL,
    "clockOutAt" TIMESTAMP(3) NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "xeroEmployeeId" TEXT,
    "xeroEarningsRateId" TEXT,
    "xeroTimesheetId" TEXT,
    "xeroExportBatchId" TEXT,
    "exportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Timesheet_staffProfileId_workDate_idx" ON "Timesheet"("staffProfileId", "workDate");

-- CreateIndex
CREATE INDEX "Timesheet_status_workDate_idx" ON "Timesheet"("status", "workDate");

-- CreateIndex
CREATE INDEX "Timesheet_xeroExportBatchId_idx" ON "Timesheet"("xeroExportBatchId");

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
