-- AlterTable
ALTER TABLE "Timesheet" ADD COLUMN "deputyTimesheetId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_deputyTimesheetId_key" ON "Timesheet"("deputyTimesheetId");
