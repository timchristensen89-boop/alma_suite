CREATE TABLE "PosPrintJob" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    CONSTRAINT "PosPrintJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PosPrintJob_profileId_status_createdAt_idx" ON "PosPrintJob"("profileId", "status", "createdAt");
