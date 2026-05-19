-- CreateEnum
CREATE TYPE "CommsThreadCategory" AS ENUM ('INBOX', 'VENUE', 'ANNOUNCEMENT', 'HANDOVER', 'TASK', 'ALERT', 'GENERAL');

-- CreateEnum
CREATE TYPE "CommsPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "CommsAlertType" AS ENUM ('ROSTER_FORECAST_COGS_HIGH', 'STOCK_VARIANCE_HIGH', 'FRIDGE_TEMP_BREACH', 'STAFF_DOCUMENT_EXPIRING', 'CHECKLIST_CRITICAL_FAIL', 'AUDIT_CRITICAL_ISSUE', 'GENERAL');

-- CreateEnum
CREATE TYPE "CommsAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CommsRecipientMode" AS ENUM ('STAFF', 'VENUE', 'ROLE', 'MANAGERS', 'ADMINS', 'CUSTOM_EMAILS');

-- CreateTable
CREATE TABLE "CommsThread" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "venue" TEXT,
    "category" "CommsThreadCategory" NOT NULL DEFAULT 'GENERAL',
    "priority" "CommsPriority" NOT NULL DEFAULT 'NORMAL',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "CommsThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommsMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "CommsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommsRecipient" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "staffProfileId" TEXT,
    "venue" TEXT,
    "role" TEXT,
    "readAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "actionRequired" BOOLEAN NOT NULL DEFAULT false,
    "dueAt" TIMESTAMP(3),

    CONSTRAINT "CommsRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommsAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "documentName" TEXT NOT NULL,
    "documentUrl" TEXT NOT NULL,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommsAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommsLink" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,

    CONSTRAINT "CommsLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommsAlertRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "venue" TEXT,
    "alertType" "CommsAlertType" NOT NULL,
    "thresholdValue" DOUBLE PRECISION,
    "thresholdUnit" TEXT,
    "recipientMode" "CommsRecipientMode" NOT NULL DEFAULT 'MANAGERS',
    "recipientEmails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommsAlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommsAlertEvent" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT,
    "threadId" TEXT,
    "alertType" "CommsAlertType" NOT NULL,
    "venue" TEXT,
    "severity" "CommsAlertSeverity" NOT NULL DEFAULT 'WARNING',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "value" DOUBLE PRECISION,
    "thresholdValue" DOUBLE PRECISION,
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommsAlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommsThread_venue_category_idx" ON "CommsThread"("venue", "category");

-- CreateIndex
CREATE INDEX "CommsThread_priority_idx" ON "CommsThread"("priority");

-- CreateIndex
CREATE INDEX "CommsThread_archivedAt_idx" ON "CommsThread"("archivedAt");

-- CreateIndex
CREATE INDEX "CommsMessage_threadId_createdAt_idx" ON "CommsMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "CommsRecipient_threadId_idx" ON "CommsRecipient"("threadId");

-- CreateIndex
CREATE INDEX "CommsRecipient_staffProfileId_readAt_idx" ON "CommsRecipient"("staffProfileId", "readAt");

-- CreateIndex
CREATE INDEX "CommsRecipient_venue_readAt_idx" ON "CommsRecipient"("venue", "readAt");

-- CreateIndex
CREATE INDEX "CommsRecipient_role_readAt_idx" ON "CommsRecipient"("role", "readAt");

-- CreateIndex
CREATE INDEX "CommsRecipient_actionRequired_dueAt_idx" ON "CommsRecipient"("actionRequired", "dueAt");

-- CreateIndex
CREATE INDEX "CommsAttachment_messageId_idx" ON "CommsAttachment"("messageId");

-- CreateIndex
CREATE INDEX "CommsLink_threadId_idx" ON "CommsLink"("threadId");

-- CreateIndex
CREATE INDEX "CommsLink_entityType_entityId_idx" ON "CommsLink"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "CommsAlertRule_enabled_alertType_idx" ON "CommsAlertRule"("enabled", "alertType");

-- CreateIndex
CREATE INDEX "CommsAlertRule_venue_idx" ON "CommsAlertRule"("venue");

-- CreateIndex
CREATE INDEX "CommsAlertEvent_alertType_createdAt_idx" ON "CommsAlertEvent"("alertType", "createdAt");

-- CreateIndex
CREATE INDEX "CommsAlertEvent_venue_createdAt_idx" ON "CommsAlertEvent"("venue", "createdAt");

-- CreateIndex
CREATE INDEX "CommsAlertEvent_severity_idx" ON "CommsAlertEvent"("severity");

-- AddForeignKey
ALTER TABLE "CommsMessage" ADD CONSTRAINT "CommsMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommsThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsRecipient" ADD CONSTRAINT "CommsRecipient_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommsThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsAttachment" ADD CONSTRAINT "CommsAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommsMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsLink" ADD CONSTRAINT "CommsLink_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommsThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsAlertEvent" ADD CONSTRAINT "CommsAlertEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CommsAlertRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsAlertEvent" ADD CONSTRAINT "CommsAlertEvent_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommsThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
