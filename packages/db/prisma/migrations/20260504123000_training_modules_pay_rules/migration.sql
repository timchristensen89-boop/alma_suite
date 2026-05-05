-- Alma Training foundation: modules, staff-linked completions, and pay-rate rules.

CREATE TYPE "TrainingModuleStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "StaffTrainingStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED');

ALTER TABLE "StaffProfile"
ADD COLUMN "trainingLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "trainingPayRateCents" INTEGER;

CREATE TABLE "TrainingModule" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT,
  "level" INTEGER NOT NULL DEFAULT 1,
  "estimatedMinutes" INTEGER,
  "status" "TrainingModuleStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TrainingModule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingLevelPayRule" (
  "id" TEXT NOT NULL,
  "level" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "payRateCents" INTEGER NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TrainingLevelPayRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StaffTrainingRecord" (
  "id" TEXT NOT NULL,
  "staffProfileId" TEXT NOT NULL,
  "moduleId" TEXT NOT NULL,
  "status" "StaffTrainingStatus" NOT NULL DEFAULT 'ASSIGNED',
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "score" DOUBLE PRECISION,
  "evidenceName" TEXT,
  "evidenceUrl" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StaffTrainingRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrainingLevelPayRule_level_key" ON "TrainingLevelPayRule"("level");
CREATE UNIQUE INDEX "StaffTrainingRecord_staffProfileId_moduleId_key" ON "StaffTrainingRecord"("staffProfileId", "moduleId");
CREATE INDEX "TrainingModule_status_level_idx" ON "TrainingModule"("status", "level");
CREATE INDEX "TrainingModule_category_idx" ON "TrainingModule"("category");
CREATE INDEX "StaffTrainingRecord_staffProfileId_status_idx" ON "StaffTrainingRecord"("staffProfileId", "status");
CREATE INDEX "StaffTrainingRecord_moduleId_status_idx" ON "StaffTrainingRecord"("moduleId", "status");

ALTER TABLE "StaffTrainingRecord"
ADD CONSTRAINT "StaffTrainingRecord_staffProfileId_fkey"
FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StaffTrainingRecord"
ADD CONSTRAINT "StaffTrainingRecord_moduleId_fkey"
FOREIGN KEY ("moduleId") REFERENCES "TrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
