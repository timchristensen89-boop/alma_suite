CREATE TABLE "SuiteAnnouncement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "appId" "AlmaAppId",
    "venue" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    CONSTRAINT "SuiteAnnouncement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SuiteChatMessage" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'general',
    "appId" "AlmaAppId",
    "venue" TEXT,
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SuiteChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SuiteAnnouncement_audience_appId_venue_createdAt_idx" ON "SuiteAnnouncement"("audience", "appId", "venue", "createdAt");
CREATE INDEX "SuiteAnnouncement_expiresAt_idx" ON "SuiteAnnouncement"("expiresAt");
CREATE INDEX "SuiteChatMessage_channel_appId_venue_createdAt_idx" ON "SuiteChatMessage"("channel", "appId", "venue", "createdAt");
CREATE INDEX "SuiteChatMessage_createdById_createdAt_idx" ON "SuiteChatMessage"("createdById", "createdAt");
