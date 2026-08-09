CREATE TABLE "PosServiceCall" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "tableLabel" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'WAITER',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),
    "clearedBy" TEXT,
    CONSTRAINT "PosServiceCall_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PosServiceCall_venue_clearedAt_idx" ON "PosServiceCall"("venue", "clearedAt");
