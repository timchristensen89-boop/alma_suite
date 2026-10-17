-- OpenTable free-API integration (Menus Partner + Restaurant Content Partner).
-- Additive only: two new tables and one enum value. No existing row changes.

ALTER TYPE "IntegrationProvider" ADD VALUE 'OPENTABLE';

CREATE TABLE "OpenTableVenueSetting" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "rid" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "menusEnabled" BOOLEAN NOT NULL DEFAULT true,
    "profileEnabled" BOOLEAN NOT NULL DEFAULT true,
    "profile" JSONB NOT NULL DEFAULT '{}',
    "profileManagedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastMenusAcceptedHash" TEXT,
    "lastMenusAcceptedAt" TIMESTAMP(3),
    "lastMenusRequestId" TEXT,
    "lastProfileAcceptedHash" TEXT,
    "lastProfileAcceptedAt" TIMESTAMP(3),
    "lastProfileRequestId" TEXT,
    "lastConnectionCheckAt" TIMESTAMP(3),
    "lastConnectionOk" BOOLEAN,
    "lastConnectionError" TEXT,
    "lastRemoteMenusJson" JSONB,
    "lastRemoteMenusAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenTableVenueSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OpenTableSyncRun" (
    "id" TEXT NOT NULL,
    "settingId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payloadHash" TEXT,
    "payload" JSONB,
    "requestKey" TEXT,
    "requestId" TEXT,
    "response" JSONB,
    "httpStatus" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "triggeredById" TEXT,
    "triggeredByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "OpenTableSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpenTableVenueSetting_venueId_key" ON "OpenTableVenueSetting"("venueId");
CREATE INDEX "OpenTableSyncRun_venueId_kind_createdAt_idx" ON "OpenTableSyncRun"("venueId", "kind", "createdAt");
CREATE INDEX "OpenTableSyncRun_venueId_status_createdAt_idx" ON "OpenTableSyncRun"("venueId", "status", "createdAt");

ALTER TABLE "OpenTableVenueSetting" ADD CONSTRAINT "OpenTableVenueSetting_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpenTableSyncRun" ADD CONSTRAINT "OpenTableSyncRun_settingId_fkey" FOREIGN KEY ("settingId") REFERENCES "OpenTableVenueSetting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
