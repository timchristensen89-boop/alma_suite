-- CreateEnum
CREATE TYPE "ShiftTaskType" AS ENUM ('CHECKLIST', 'STOCKTAKE', 'AUDIT', 'INCIDENT_CHECK');

-- CreateEnum
CREATE TYPE "ShiftTaskDueTiming" AS ENUM ('BEFORE_SHIFT_START', 'DURING_SHIFT', 'BEFORE_SHIFT_END', 'AFTER_SHIFT_END');

-- CreateEnum
CREATE TYPE "ShiftTaskAssignmentTarget" AS ENUM ('ASSIGNED_STAFF', 'VENUE_QUEUE', 'MANAGER_ON_DUTY', 'ALL_ON_SHIFT');

-- CreateEnum
CREATE TYPE "ShiftTaskAssignmentStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'CANCELLED');

-- CreateTable
CREATE TABLE "ShiftTaskRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "venue" TEXT,
    "matchRoleTitle" TEXT,
    "matchArea" TEXT,
    "matchShiftLabel" TEXT,
    "startBeforeMinutes" INTEGER,
    "startAfterMinutes" INTEGER,
    "endBeforeMinutes" INTEGER,
    "endAfterMinutes" INTEGER,
    "daysOfWeek" JSONB,
    "taskType" "ShiftTaskType" NOT NULL,
    "checklistTemplateId" TEXT,
    "stocktakeTemplate" TEXT,
    "dueTiming" "ShiftTaskDueTiming" NOT NULL DEFAULT 'DURING_SHIFT',
    "dueOffsetMinutes" INTEGER,
    "assignmentTarget" "ShiftTaskAssignmentTarget" NOT NULL DEFAULT 'ASSIGNED_STAFF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftTaskRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftTaskAssignment" (
    "id" TEXT NOT NULL,
    "assignmentKey" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "rosterShiftId" TEXT,
    "staffProfileId" TEXT,
    "venue" TEXT,
    "taskType" "ShiftTaskType" NOT NULL,
    "checklistTemplateId" TEXT,
    "checklistRunId" TEXT,
    "stocktakeId" TEXT,
    "status" "ShiftTaskAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftTaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShiftTaskAssignment_assignmentKey_key" ON "ShiftTaskAssignment"("assignmentKey");

-- CreateIndex
CREATE INDEX "ShiftTaskRule_enabled_venue_idx" ON "ShiftTaskRule"("enabled", "venue");

-- CreateIndex
CREATE INDEX "ShiftTaskRule_taskType_idx" ON "ShiftTaskRule"("taskType");

-- CreateIndex
CREATE INDEX "ShiftTaskRule_checklistTemplateId_idx" ON "ShiftTaskRule"("checklistTemplateId");

-- CreateIndex
CREATE INDEX "ShiftTaskAssignment_ruleId_idx" ON "ShiftTaskAssignment"("ruleId");

-- CreateIndex
CREATE INDEX "ShiftTaskAssignment_rosterShiftId_idx" ON "ShiftTaskAssignment"("rosterShiftId");

-- CreateIndex
CREATE INDEX "ShiftTaskAssignment_staffProfileId_idx" ON "ShiftTaskAssignment"("staffProfileId");

-- CreateIndex
CREATE INDEX "ShiftTaskAssignment_venue_status_idx" ON "ShiftTaskAssignment"("venue", "status");

-- CreateIndex
CREATE INDEX "ShiftTaskAssignment_dueAt_idx" ON "ShiftTaskAssignment"("dueAt");

-- CreateIndex
CREATE INDEX "ShiftTaskAssignment_checklistTemplateId_idx" ON "ShiftTaskAssignment"("checklistTemplateId");

-- CreateIndex
CREATE INDEX "ShiftTaskAssignment_checklistRunId_idx" ON "ShiftTaskAssignment"("checklistRunId");

-- CreateIndex
CREATE INDEX "ShiftTaskAssignment_stocktakeId_idx" ON "ShiftTaskAssignment"("stocktakeId");

-- AddForeignKey
ALTER TABLE "ShiftTaskRule" ADD CONSTRAINT "ShiftTaskRule_checklistTemplateId_fkey" FOREIGN KEY ("checklistTemplateId") REFERENCES "ChecklistTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTaskAssignment" ADD CONSTRAINT "ShiftTaskAssignment_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ShiftTaskRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTaskAssignment" ADD CONSTRAINT "ShiftTaskAssignment_rosterShiftId_fkey" FOREIGN KEY ("rosterShiftId") REFERENCES "RosterShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTaskAssignment" ADD CONSTRAINT "ShiftTaskAssignment_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTaskAssignment" ADD CONSTRAINT "ShiftTaskAssignment_checklistTemplateId_fkey" FOREIGN KEY ("checklistTemplateId") REFERENCES "ChecklistTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTaskAssignment" ADD CONSTRAINT "ShiftTaskAssignment_checklistRunId_fkey" FOREIGN KEY ("checklistRunId") REFERENCES "ChecklistRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTaskAssignment" ADD CONSTRAINT "ShiftTaskAssignment_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "Stocktake"("id") ON DELETE SET NULL ON UPDATE CASCADE;
