-- Forecasting sync cursors and runs. Additive only (see the 20260728000000 migration note on schema drift).

-- CreateTable
CREATE TABLE "fc_sync_cursors" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceSystem" "FcSourceSystem" NOT NULL,
    "sourceEntity" TEXT NOT NULL,
    "cursor" TEXT,
    "lastModifiedAt" TIMESTAMP(3),
    "lastBusinessDate" TIMESTAMP(3),
    "lastSuccessfulAt" TIMESTAMP(3),
    "lastError" TEXT,
    "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fc_sync_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_sync_runs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceSystem" "FcSourceSystem" NOT NULL,
    "sourceEntity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "recordsFetched" INTEGER NOT NULL DEFAULT 0,
    "recordsWritten" INTEGER NOT NULL DEFAULT 0,
    "duplicatesSkipped" INTEGER NOT NULL DEFAULT 0,
    "rateLimitHits" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "error" TEXT,
    "triggeredBy" TEXT,

    CONSTRAINT "fc_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fc_sync_cursors_companyId_sourceSystem_idx" ON "fc_sync_cursors"("companyId", "sourceSystem");

-- CreateIndex
CREATE UNIQUE INDEX "fc_sync_cursors_companyId_sourceSystem_sourceEntity_key" ON "fc_sync_cursors"("companyId", "sourceSystem", "sourceEntity");

-- CreateIndex
CREATE INDEX "fc_sync_runs_companyId_sourceSystem_startedAt_idx" ON "fc_sync_runs"("companyId", "sourceSystem", "startedAt");
