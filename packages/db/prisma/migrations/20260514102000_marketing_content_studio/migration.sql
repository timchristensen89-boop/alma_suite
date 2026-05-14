-- Add Marketing Content Studio foundation for asset library, social post
-- drafting, approval, scheduling, and simulation-only publish attempts.

CREATE TYPE "MarketingContentAssetType" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT');

CREATE TYPE "MarketingContentAssetStorageProvider" AS ENUM ('LOCAL', 'CLOUD_STORAGE', 'EXTERNAL_URL');

CREATE TYPE "MarketingContentAssetStatus" AS ENUM ('DRAFT', 'READY', 'ARCHIVED');

CREATE TYPE "MarketingContentAssetSource" AS ENUM ('UPLOAD', 'IMPORT', 'GENERATED');

CREATE TYPE "MarketingContentPostStatus" AS ENUM (
  'IDEA',
  'DRAFT',
  'NEEDS_REVIEW',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'CANCELLED',
  'ARCHIVED'
);

CREATE TYPE "MarketingSocialPlatform" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'TIKTOK');

CREATE TYPE "MarketingSocialAccountStatus" AS ENUM (
  'SETUP_REQUIRED',
  'CONNECTED',
  'EXPIRED',
  'DISABLED',
  'ERROR'
);

CREATE TYPE "MarketingContentPublishStatus" AS ENUM (
  'SIMULATED',
  'QUEUED',
  'SKIPPED',
  'PUBLISHED',
  'FAILED'
);

CREATE TYPE "MarketingContentPublishMode" AS ENUM ('SIMULATION', 'LIVE');

CREATE TABLE "MarketingContentAsset" (
  "id" TEXT NOT NULL,
  "venue" TEXT NOT NULL,
  "uploadedByStaffId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "assetType" "MarketingContentAssetType" NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL,
  "storageProvider" "MarketingContentAssetStorageProvider" NOT NULL DEFAULT 'EXTERNAL_URL',
  "storagePath" TEXT,
  "publicUrl" TEXT,
  "thumbnailUrl" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "durationSeconds" INTEGER,
  "status" "MarketingContentAssetStatus" NOT NULL DEFAULT 'DRAFT',
  "tags" JSONB NOT NULL DEFAULT '[]',
  "source" "MarketingContentAssetSource" NOT NULL DEFAULT 'UPLOAD',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MarketingContentAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketingContentPost" (
  "id" TEXT NOT NULL,
  "venue" TEXT NOT NULL,
  "createdByStaffId" TEXT,
  "title" TEXT NOT NULL,
  "caption" TEXT NOT NULL,
  "status" "MarketingContentPostStatus" NOT NULL DEFAULT 'DRAFT',
  "scheduledAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "campaignId" TEXT,
  "targetChannels" JSONB NOT NULL DEFAULT '[]',
  "contentPillar" TEXT,
  "approvalRequired" BOOLEAN NOT NULL DEFAULT true,
  "approvedByStaffId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MarketingContentPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketingContentPostAsset" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MarketingContentPostAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketingSocialAccount" (
  "id" TEXT NOT NULL,
  "venue" TEXT NOT NULL,
  "platform" "MarketingSocialPlatform" NOT NULL,
  "displayName" TEXT NOT NULL,
  "handle" TEXT,
  "externalAccountId" TEXT,
  "status" "MarketingSocialAccountStatus" NOT NULL DEFAULT 'SETUP_REQUIRED',
  "scopes" JSONB NOT NULL DEFAULT '[]',
  "tokenSecretRef" TEXT,
  "lastConnectedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MarketingSocialAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketingContentPublishAttempt" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "platform" "MarketingSocialPlatform" NOT NULL,
  "socialAccountId" TEXT,
  "status" "MarketingContentPublishStatus" NOT NULL DEFAULT 'SIMULATED',
  "mode" "MarketingContentPublishMode" NOT NULL DEFAULT 'SIMULATION',
  "requestPreview" JSONB,
  "responsePreview" JSONB,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),

  CONSTRAINT "MarketingContentPublishAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketingContentAsset_venue_status_idx"
ON "MarketingContentAsset"("venue", "status");

CREATE INDEX "MarketingContentAsset_venue_createdAt_idx"
ON "MarketingContentAsset"("venue", "createdAt");

CREATE INDEX "MarketingContentAsset_assetType_idx"
ON "MarketingContentAsset"("assetType");

CREATE INDEX "MarketingContentPost_venue_status_idx"
ON "MarketingContentPost"("venue", "status");

CREATE INDEX "MarketingContentPost_venue_scheduledAt_idx"
ON "MarketingContentPost"("venue", "scheduledAt");

CREATE INDEX "MarketingContentPost_venue_createdAt_idx"
ON "MarketingContentPost"("venue", "createdAt");

CREATE INDEX "MarketingContentPost_campaignId_idx"
ON "MarketingContentPost"("campaignId");

CREATE UNIQUE INDEX "MarketingContentPostAsset_postId_assetId_key"
ON "MarketingContentPostAsset"("postId", "assetId");

CREATE INDEX "MarketingContentPostAsset_postId_idx"
ON "MarketingContentPostAsset"("postId");

CREATE INDEX "MarketingContentPostAsset_assetId_idx"
ON "MarketingContentPostAsset"("assetId");

CREATE INDEX "MarketingSocialAccount_venue_platform_idx"
ON "MarketingSocialAccount"("venue", "platform");

CREATE INDEX "MarketingSocialAccount_venue_status_idx"
ON "MarketingSocialAccount"("venue", "status");

CREATE INDEX "MarketingSocialAccount_platform_status_idx"
ON "MarketingSocialAccount"("platform", "status");

CREATE INDEX "MarketingContentPublishAttempt_postId_idx"
ON "MarketingContentPublishAttempt"("postId");

CREATE INDEX "MarketingContentPublishAttempt_platform_idx"
ON "MarketingContentPublishAttempt"("platform");

CREATE INDEX "MarketingContentPublishAttempt_socialAccountId_idx"
ON "MarketingContentPublishAttempt"("socialAccountId");

CREATE INDEX "MarketingContentPublishAttempt_mode_status_idx"
ON "MarketingContentPublishAttempt"("mode", "status");

ALTER TABLE "MarketingContentPostAsset"
ADD CONSTRAINT "MarketingContentPostAsset_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "MarketingContentPost"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketingContentPostAsset"
ADD CONSTRAINT "MarketingContentPostAsset_assetId_fkey"
FOREIGN KEY ("assetId") REFERENCES "MarketingContentAsset"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketingContentPublishAttempt"
ADD CONSTRAINT "MarketingContentPublishAttempt_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "MarketingContentPost"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketingContentPublishAttempt"
ADD CONSTRAINT "MarketingContentPublishAttempt_socialAccountId_fkey"
FOREIGN KEY ("socialAccountId") REFERENCES "MarketingSocialAccount"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
