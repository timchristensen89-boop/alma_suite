-- CreateEnum
CREATE TYPE "StaffRecordType" AS ENUM ('RSA', 'RSG', 'FSS', 'FIRST_AID', 'FOOD_SAFETY', 'ALLERGEN', 'TRAINING', 'OTHER');

-- CreateEnum
CREATE TYPE "StaffRecordStatus" AS ENUM ('PENDING', 'APPROVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'CLOSED');

-- CreateEnum
CREATE TYPE "TemperatureAssetStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TemperatureLogSource" AS ENUM ('MANUAL', 'GOVEE');

-- CreateEnum
CREATE TYPE "TemperatureLogStatus" AS ENUM ('IN_RANGE', 'OUT_OF_RANGE');

-- CreateTable
CREATE TABLE "StaffProfile" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "venue" TEXT,
    "employmentStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffComplianceRecord" (
    "id" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "recordType" "StaffRecordType" NOT NULL,
    "title" TEXT NOT NULL,
    "issuer" TEXT,
    "certificateNumber" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "status" "StaffRecordStatus" NOT NULL DEFAULT 'PENDING',
    "documentName" TEXT,
    "documentUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffComplianceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentReport" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "incidentType" TEXT NOT NULL,
    "severity" "IssueSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "reportedBy" TEXT NOT NULL,
    "venue" TEXT,
    "location" TEXT,
    "summary" TEXT NOT NULL,
    "immediateActions" TEXT,
    "treatmentProvided" TEXT,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "followUpNotes" TEXT,
    "linkedIssueId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentPerson" (
    "id" TEXT NOT NULL,
    "incidentReportId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "involvement" TEXT NOT NULL,
    "contactDetails" TEXT,
    "injuryDetails" TEXT,
    "witnessStatement" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemperatureAsset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "venue" TEXT,
    "area" TEXT,
    "assetType" TEXT NOT NULL,
    "minTempC" DOUBLE PRECISION NOT NULL,
    "maxTempC" DOUBLE PRECISION NOT NULL,
    "integrationProvider" TEXT,
    "externalDeviceId" TEXT,
    "externalModel" TEXT,
    "externalSku" TEXT,
    "lastReadingAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "status" "TemperatureAssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemperatureAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemperatureLog" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "temperatureC" DOUBLE PRECISION NOT NULL,
    "humidityPct" DOUBLE PRECISION,
    "source" "TemperatureLogSource" NOT NULL DEFAULT 'MANUAL',
    "status" "TemperatureLogStatus" NOT NULL,
    "correctiveAction" TEXT,
    "recordedBy" TEXT,
    "externalReadingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemperatureLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffComplianceRecord_staffProfileId_recordType_idx" ON "StaffComplianceRecord"("staffProfileId", "recordType");

-- CreateIndex
CREATE INDEX "TemperatureLog_assetId_recordedAt_idx" ON "TemperatureLog"("assetId", "recordedAt");

-- AddForeignKey
ALTER TABLE "StaffComplianceRecord" ADD CONSTRAINT "StaffComplianceRecord_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_linkedIssueId_fkey" FOREIGN KEY ("linkedIssueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentPerson" ADD CONSTRAINT "IncidentPerson_incidentReportId_fkey" FOREIGN KEY ("incidentReportId") REFERENCES "IncidentReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemperatureLog" ADD CONSTRAINT "TemperatureLog_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "TemperatureAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
