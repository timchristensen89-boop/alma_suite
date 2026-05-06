CREATE TYPE "SuiteChatChannelType" AS ENUM ('GENERAL', 'VENUE', 'AREA', 'GROUP', 'DIRECT');

ALTER TABLE "SuiteAnnouncement"
  ADD COLUMN "updatedById" TEXT,
  ADD COLUMN "updatedByName" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT,
  ADD COLUMN "deletedByName" TEXT;

CREATE TABLE "SuiteChatChannel" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "channelKey" TEXT NOT NULL,
  "type" "SuiteChatChannelType" NOT NULL DEFAULT 'GROUP',
  "appId" "AlmaAppId",
  "venue" TEXT,
  "groupKey" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "readPermission" TEXT,
  "postPermission" TEXT,
  "directMessagesAllowed" BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT,
  "createdByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SuiteChatChannel_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SuiteChatMessage"
  ADD COLUMN "channelId" TEXT,
  ADD COLUMN "channelType" "SuiteChatChannelType" NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "recipientId" TEXT,
  ADD COLUMN "recipientName" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "editedAt" TIMESTAMP(3),
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT,
  ADD COLUMN "deletedByName" TEXT;

ALTER TABLE "SuiteChatMessage" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE UNIQUE INDEX "SuiteChatChannel_channelKey_key" ON "SuiteChatChannel"("channelKey");
CREATE INDEX "SuiteAnnouncement_deletedAt_idx" ON "SuiteAnnouncement"("deletedAt");
CREATE INDEX "SuiteChatChannel_type_appId_venue_isActive_idx" ON "SuiteChatChannel"("type", "appId", "venue", "isActive");
CREATE INDEX "SuiteChatChannel_groupKey_idx" ON "SuiteChatChannel"("groupKey");
CREATE INDEX "SuiteChatMessage_channelId_createdAt_idx" ON "SuiteChatMessage"("channelId", "createdAt");
CREATE INDEX "SuiteChatMessage_recipientId_createdAt_idx" ON "SuiteChatMessage"("recipientId", "createdAt");
CREATE INDEX "SuiteChatMessage_deletedAt_idx" ON "SuiteChatMessage"("deletedAt");

ALTER TABLE "SuiteChatMessage" ADD CONSTRAINT "SuiteChatMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "SuiteChatChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
