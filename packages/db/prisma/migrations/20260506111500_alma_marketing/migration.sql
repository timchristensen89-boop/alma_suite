-- AddEnumValues
ALTER TYPE "AlmaAppId" ADD VALUE IF NOT EXISTS 'RESERVE';
ALTER TYPE "AlmaAppId" ADD VALUE IF NOT EXISTS 'MARKETING';

-- CreateEnum
CREATE TYPE "MarketingChannel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "MarketingCampaignStatus" AS ENUM ('DRAFT', 'READY', 'SENT', 'ARCHIVED');

-- CreateTable
CREATE TABLE "MarketingContact" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "venue" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consentEmail" BOOLEAN NOT NULL DEFAULT false,
    "consentSms" BOOLEAN NOT NULL DEFAULT false,
    "totalVisits" INTEGER NOT NULL DEFAULT 0,
    "lastVisitAt" TIMESTAMP(3),
    "allergyNotes" TEXT,
    "notes" TEXT,
    "reserveGuestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingSegment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "venue" TEXT,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "MarketingChannel" NOT NULL,
    "status" "MarketingCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "audienceName" TEXT,
    "subject" TEXT,
    "previewText" TEXT,
    "body" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingCampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingContact_reserveGuestId_key" ON "MarketingContact"("reserveGuestId");

-- CreateIndex
CREATE INDEX "MarketingContact_lastName_firstName_idx" ON "MarketingContact"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "MarketingContact_email_idx" ON "MarketingContact"("email");

-- CreateIndex
CREATE INDEX "MarketingContact_phone_idx" ON "MarketingContact"("phone");

-- CreateIndex
CREATE INDEX "MarketingContact_venue_idx" ON "MarketingContact"("venue");

-- CreateIndex
CREATE INDEX "MarketingContact_source_idx" ON "MarketingContact"("source");

-- CreateIndex
CREATE INDEX "MarketingSegment_venue_idx" ON "MarketingSegment"("venue");

-- CreateIndex
CREATE INDEX "MarketingSegment_isActive_idx" ON "MarketingSegment"("isActive");

-- CreateIndex
CREATE INDEX "MarketingCampaign_status_channel_idx" ON "MarketingCampaign"("status", "channel");

-- CreateIndex
CREATE INDEX "MarketingCampaign_scheduledFor_idx" ON "MarketingCampaign"("scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCampaignRecipient_campaignId_contactId_key" ON "MarketingCampaignRecipient"("campaignId", "contactId");

-- CreateIndex
CREATE INDEX "MarketingCampaignRecipient_contactId_idx" ON "MarketingCampaignRecipient"("contactId");

-- CreateIndex
CREATE INDEX "MarketingCampaignRecipient_status_idx" ON "MarketingCampaignRecipient"("status");

-- AddForeignKey
ALTER TABLE "MarketingContact" ADD CONSTRAINT "MarketingContact_reserveGuestId_fkey" FOREIGN KEY ("reserveGuestId") REFERENCES "ReserveGuest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaignRecipient" ADD CONSTRAINT "MarketingCampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaignRecipient" ADD CONSTRAINT "MarketingCampaignRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "MarketingContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
