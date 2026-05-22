-- Add account-scoped Square webhook event metadata. This is additive for
-- existing webhook rows and keeps old rows addressable under accountKey=default.
ALTER TABLE "IntegrationWebhookEvent"
  ADD COLUMN "accountKey" TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN "merchantId" TEXT,
  ADD COLUMN "locationId" TEXT,
  ADD COLUMN "providerCreatedAt" TIMESTAMP(3),
  ADD COLUMN "payload" JSONB NOT NULL DEFAULT '{}';

DROP INDEX IF EXISTS "IntegrationWebhookEvent_provider_providerEventId_key";
CREATE UNIQUE INDEX "IntegrationWebhookEvent_provider_accountKey_providerEventId_key"
  ON "IntegrationWebhookEvent"("provider", "accountKey", "providerEventId");
CREATE INDEX "IntegrationWebhookEvent_provider_accountKey_receivedAt_idx"
  ON "IntegrationWebhookEvent"("provider", "accountKey", "receivedAt");
CREATE INDEX "IntegrationWebhookEvent_provider_eventType_receivedAt_idx"
  ON "IntegrationWebhookEvent"("provider", "eventType", "receivedAt");
