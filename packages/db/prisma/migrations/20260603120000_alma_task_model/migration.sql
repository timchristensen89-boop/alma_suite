-- CreateEnum
CREATE TYPE "AlmaTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AlmaTaskPriority" AS ENUM ('CRITICAL', 'TODAY', 'THIS_WEEK', 'LOW');

-- CreateEnum
CREATE TYPE "AlmaTaskSourceApp" AS ENUM ('HOME', 'STAFF', 'STOCK', 'COMPLIANCE', 'RESERVE', 'MARKETING', 'GIFTCARDS', 'REPORTS', 'ADMIN', 'COMMS');

-- CreateTable
CREATE TABLE "AlmaTask" (
    "id" TEXT NOT NULL,
    "sourceApp" "AlmaTaskSourceApp" NOT NULL,
    "sourceRefType" TEXT,
    "sourceRefId" TEXT,
    "venue" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ownerStaffProfileId" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "AlmaTaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "AlmaTaskPriority" NOT NULL DEFAULT 'THIS_WEEK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "completedByStaffProfileId" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "dismissedByStaffProfileId" TEXT,

    CONSTRAINT "AlmaTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlmaTask_venue_status_idx" ON "AlmaTask"("venue", "status");

-- CreateIndex
CREATE INDEX "AlmaTask_ownerStaffProfileId_status_idx" ON "AlmaTask"("ownerStaffProfileId", "status");

-- CreateIndex
CREATE INDEX "AlmaTask_priority_status_idx" ON "AlmaTask"("priority", "status");

-- CreateIndex
CREATE INDEX "AlmaTask_sourceApp_status_idx" ON "AlmaTask"("sourceApp", "status");

-- CreateIndex
CREATE INDEX "AlmaTask_sourceRefType_sourceRefId_idx" ON "AlmaTask"("sourceRefType", "sourceRefId");

-- CreateIndex
CREATE INDEX "AlmaTask_dueAt_idx" ON "AlmaTask"("dueAt");

-- AddForeignKey
ALTER TABLE "AlmaTask" ADD CONSTRAINT "AlmaTask_ownerStaffProfileId_fkey" FOREIGN KEY ("ownerStaffProfileId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlmaTask" ADD CONSTRAINT "AlmaTask_completedByStaffProfileId_fkey" FOREIGN KEY ("completedByStaffProfileId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlmaTask" ADD CONSTRAINT "AlmaTask_dismissedByStaffProfileId_fkey" FOREIGN KEY ("dismissedByStaffProfileId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
