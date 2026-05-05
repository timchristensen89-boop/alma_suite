-- CreateEnum
CREATE TYPE "AlmaAppId" AS ENUM ('COMPLIANCE', 'STOCK', 'STAFF', 'REPORTS', 'TRAINING', 'SETTINGS');

-- CreateEnum
CREATE TYPE "StaffAppAccessStatus" AS ENUM ('ENABLED', 'DISABLED', 'PENDING');

-- CreateEnum
CREATE TYPE "RosterShiftStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "StaffAppAccess" (
    "id" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "appId" "AlmaAppId" NOT NULL,
    "status" "StaffAppAccessStatus" NOT NULL DEFAULT 'DISABLED',
    "role" TEXT NOT NULL DEFAULT 'USER',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffAppAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterShift" (
    "id" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "venue" TEXT,
    "area" TEXT,
    "roleTitle" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "RosterShiftStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RosterShift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffAppAccess_appId_status_idx" ON "StaffAppAccess"("appId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAppAccess_staffProfileId_appId_key" ON "StaffAppAccess"("staffProfileId", "appId");

-- CreateIndex
CREATE INDEX "RosterShift_staffProfileId_startsAt_idx" ON "RosterShift"("staffProfileId", "startsAt");

-- CreateIndex
CREATE INDEX "RosterShift_startsAt_endsAt_idx" ON "RosterShift"("startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "StaffAppAccess" ADD CONSTRAINT "StaffAppAccess_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterShift" ADD CONSTRAINT "RosterShift_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
