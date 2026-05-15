-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('SQUARE', 'XERO');

-- CreateEnum
CREATE TYPE "IntegrationConnectionStatus" AS ENUM ('NOT_CONNECTED', 'CONNECTED', 'ERROR', 'REVOKED');

-- CreateEnum
CREATE TYPE "IntegrationSyncType" AS ENUM ('MANUAL', 'WEBHOOK', 'SCHEDULED', 'BACKFILL', 'TEST', 'OAUTH_CALLBACK');

-- CreateEnum
CREATE TYPE "IntegrationSyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'ERROR');

-- CreateEnum
CREATE TYPE "IntegrationWebhookEventStatus" AS ENUM ('RECEIVED', 'DUPLICATE', 'IGNORED', 'ERROR');

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "scopeType" TEXT NOT NULL DEFAULT 'BUSINESS',
    "venueId" TEXT,
    "status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" "IntegrationSyncStatus",
    "lastError" TEXT,
    "providerAccountId" TEXT,
    "providerAccountName" TEXT,
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "tokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "tokenSecretRef" TEXT,
    "refreshTokenSecretRef" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSyncRun" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "provider" "IntegrationProvider" NOT NULL,
    "syncType" "IntegrationSyncType" NOT NULL,
    "status" "IntegrationSyncStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "recordsImported" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,

    CONSTRAINT "IntegrationSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationOAuthState" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "stateHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "redirectPath" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "provider" "IntegrationProvider" NOT NULL,
    "eventType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationWebhookEvent" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "provider" "IntegrationProvider" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT,
    "status" "IntegrationWebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "errorSummary" TEXT,

    CONSTRAINT "IntegrationWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationConnection_provider_status_idx" ON "IntegrationConnection"("provider", "status");

-- CreateIndex
CREATE INDEX "IntegrationConnection_scopeType_venueId_idx" ON "IntegrationConnection"("scopeType", "venueId");

-- CreateIndex
CREATE INDEX "IntegrationConnection_updatedAt_idx" ON "IntegrationConnection"("updatedAt");

-- CreateIndex
CREATE INDEX "IntegrationSyncRun_provider_startedAt_idx" ON "IntegrationSyncRun"("provider", "startedAt");

-- CreateIndex
CREATE INDEX "IntegrationSyncRun_connectionId_startedAt_idx" ON "IntegrationSyncRun"("connectionId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationOAuthState_stateHash_key" ON "IntegrationOAuthState"("stateHash");

-- CreateIndex
CREATE INDEX "IntegrationOAuthState_provider_expiresAt_idx" ON "IntegrationOAuthState"("provider", "expiresAt");

-- CreateIndex
CREATE INDEX "IntegrationEvent_provider_createdAt_idx" ON "IntegrationEvent"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationEvent_connectionId_createdAt_idx" ON "IntegrationEvent"("connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationWebhookEvent_provider_receivedAt_idx" ON "IntegrationWebhookEvent"("provider", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationWebhookEvent_provider_providerEventId_key" ON "IntegrationWebhookEvent"("provider", "providerEventId");

-- AddForeignKey
ALTER TABLE "IntegrationSyncRun" ADD CONSTRAINT "IntegrationSyncRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationEvent" ADD CONSTRAINT "IntegrationEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationWebhookEvent" ADD CONSTRAINT "IntegrationWebhookEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
