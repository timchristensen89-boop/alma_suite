-- CreateEnum
CREATE TYPE "GuestTagType" AS ENUM ('MANUAL', 'AUTOMATIC', 'SYSTEM', 'CUSTOM');

-- CreateEnum
CREATE TYPE "GuestTagAssignmentSource" AS ENUM ('MANUAL', 'AUTOMATIC', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MarketingEmailTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MarketingAutomationTriggerType" AS ENUM ('FIRST_VISIT_COMPLETED', 'REPEAT_VISIT', 'LAPSED_GUEST', 'BIRTHDAY_UPCOMING', 'RESERVATION_CREATED', 'RESERVATION_CANCELLED', 'NO_SHOW', 'BIG_SPENDER');

-- CreateEnum
CREATE TYPE "MarketingAutomationRunStatus" AS ENUM ('PENDING', 'SKIPPED', 'SENT', 'FAILED', 'SIMULATED');

-- CreateEnum
CREATE TYPE "GoogleReserveIntegrationStatus" AS ENUM ('SETUP_REQUIRED', 'PENDING', 'ACTIVE', 'ERROR');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MarketingCampaignStatus" ADD VALUE 'SCHEDULED';
ALTER TYPE "MarketingCampaignStatus" ADD VALUE 'SENDING';
ALTER TYPE "MarketingCampaignStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "MarketingCampaign" ADD COLUMN     "segmentDefinition" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "simulatedAt" TIMESTAMP(3),
ADD COLUMN     "textBody" TEXT,
ADD COLUMN     "venue" TEXT;

-- AlterTable
ALTER TABLE "MarketingCampaignRecipient" ADD COLUMN     "clickedAt" TIMESTAMP(3),
ADD COLUMN     "email" TEXT,
ADD COLUMN     "guestId" TEXT,
ADD COLUMN     "openedAt" TIMESTAMP(3),
ADD COLUMN     "skipReason" TEXT;

-- AlterTable
ALTER TABLE "ReserveGuest" ADD COLUMN     "birthday" TIMESTAMP(3),
ADD COLUMN     "dietaryNotes" TEXT,
ADD COLUMN     "emailUnsubscribedAt" TIMESTAMP(3),
ADD COLUMN     "firstVisitAt" TIMESTAMP(3),
ADD COLUMN     "lastVisitAt" TIMESTAMP(3),
ADD COLUMN     "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "noShowCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "preferences" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "smsUnsubscribedAt" TIMESTAMP(3),
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'staff_created',
ADD COLUMN     "totalSpendCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalVisits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "venue" TEXT;

-- AlterTable
ALTER TABLE "ReserveReservation" ADD COLUMN     "availabilityRuleId" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "guestEmail" TEXT,
ADD COLUMN     "guestName" TEXT,
ADD COLUMN     "guestPhone" TEXT,
ADD COLUMN     "internalNotes" TEXT,
ADD COLUMN     "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "specialRequests" TEXT;

-- CreateTable
CREATE TABLE "ReserveAvailabilityRule" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "servicePeriod" "ReserveServicePeriod",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "defaultDurationMinutes" INTEGER NOT NULL DEFAULT 120,
    "minPartySize" INTEGER NOT NULL DEFAULT 1,
    "maxPartySize" INTEGER NOT NULL,
    "daysOfWeek" INTEGER[],
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 30,
    "capacity" INTEGER NOT NULL,
    "onlineEnabled" BOOLEAN NOT NULL DEFAULT true,
    "googleReserveEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReserveAvailabilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReserveBlackout" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reason" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReserveBlackout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleReserveIntegrationSetting" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "merchantId" TEXT,
    "integrationStatus" "GoogleReserveIntegrationStatus" NOT NULL DEFAULT 'SETUP_REQUIRED',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleReserveIntegrationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestTag" (
    "id" TEXT NOT NULL,
    "venue" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "type" "GuestTagType" NOT NULL DEFAULT 'MANUAL',
    "color" TEXT,
    "ruleDefinition" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestTagAssignment" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "source" "GuestTagAssignmentSource" NOT NULL DEFAULT 'MANUAL',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedByStaffId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "GuestTagAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingEmailTemplate" (
    "id" TEXT NOT NULL,
    "venue" TEXT,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "previewText" TEXT,
    "htmlBody" TEXT NOT NULL,
    "textBody" TEXT,
    "status" "MarketingEmailTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingEmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAutomation" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerType" "MarketingAutomationTriggerType" NOT NULL,
    "segmentDefinition" JSONB NOT NULL DEFAULT '{}',
    "emailTemplateId" TEXT,
    "delayHours" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAutomationRun" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "reservationId" TEXT,
    "status" "MarketingAutomationRunStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingAutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReserveAvailabilityRule_venue_active_idx" ON "ReserveAvailabilityRule"("venue", "active");

-- CreateIndex
CREATE INDEX "ReserveAvailabilityRule_venue_onlineEnabled_idx" ON "ReserveAvailabilityRule"("venue", "onlineEnabled");

-- CreateIndex
CREATE INDEX "ReserveBlackout_venue_startAt_endAt_idx" ON "ReserveBlackout"("venue", "startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleReserveIntegrationSetting_venue_key" ON "GoogleReserveIntegrationSetting"("venue");

-- CreateIndex
CREATE UNIQUE INDEX "GuestTag_slug_key" ON "GuestTag"("slug");

-- CreateIndex
CREATE INDEX "GuestTag_venue_active_idx" ON "GuestTag"("venue", "active");

-- CreateIndex
CREATE INDEX "GuestTag_type_idx" ON "GuestTag"("type");

-- CreateIndex
CREATE INDEX "GuestTagAssignment_tagId_idx" ON "GuestTagAssignment"("tagId");

-- CreateIndex
CREATE INDEX "GuestTagAssignment_source_idx" ON "GuestTagAssignment"("source");

-- CreateIndex
CREATE UNIQUE INDEX "GuestTagAssignment_guestId_tagId_key" ON "GuestTagAssignment"("guestId", "tagId");

-- CreateIndex
CREATE INDEX "MarketingEmailTemplate_venue_status_idx" ON "MarketingEmailTemplate"("venue", "status");

-- CreateIndex
CREATE INDEX "MarketingAutomation_venue_active_idx" ON "MarketingAutomation"("venue", "active");

-- CreateIndex
CREATE INDEX "MarketingAutomation_triggerType_idx" ON "MarketingAutomation"("triggerType");

-- CreateIndex
CREATE INDEX "MarketingAutomationRun_automationId_status_idx" ON "MarketingAutomationRun"("automationId", "status");

-- CreateIndex
CREATE INDEX "MarketingAutomationRun_guestId_idx" ON "MarketingAutomationRun"("guestId");

-- CreateIndex
CREATE INDEX "MarketingAutomationRun_reservationId_idx" ON "MarketingAutomationRun"("reservationId");

-- CreateIndex
CREATE INDEX "MarketingCampaign_venue_status_idx" ON "MarketingCampaign"("venue", "status");

-- CreateIndex
CREATE INDEX "MarketingCampaignRecipient_guestId_idx" ON "MarketingCampaignRecipient"("guestId");

-- CreateIndex
CREATE INDEX "MarketingCampaignRecipient_email_idx" ON "MarketingCampaignRecipient"("email");

-- CreateIndex
CREATE INDEX "ReserveGuest_venue_idx" ON "ReserveGuest"("venue");

-- CreateIndex
CREATE INDEX "ReserveReservation_availabilityRuleId_idx" ON "ReserveReservation"("availabilityRuleId");

-- AddForeignKey
ALTER TABLE "ReserveReservation" ADD CONSTRAINT "ReserveReservation_availabilityRuleId_fkey" FOREIGN KEY ("availabilityRuleId") REFERENCES "ReserveAvailabilityRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestTagAssignment" ADD CONSTRAINT "GuestTagAssignment_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "ReserveGuest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestTagAssignment" ADD CONSTRAINT "GuestTagAssignment_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "GuestTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaignRecipient" ADD CONSTRAINT "MarketingCampaignRecipient_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "ReserveGuest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAutomation" ADD CONSTRAINT "MarketingAutomation_emailTemplateId_fkey" FOREIGN KEY ("emailTemplateId") REFERENCES "MarketingEmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAutomationRun" ADD CONSTRAINT "MarketingAutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "MarketingAutomation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAutomationRun" ADD CONSTRAINT "MarketingAutomationRun_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "ReserveGuest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAutomationRun" ADD CONSTRAINT "MarketingAutomationRun_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "ReserveReservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
