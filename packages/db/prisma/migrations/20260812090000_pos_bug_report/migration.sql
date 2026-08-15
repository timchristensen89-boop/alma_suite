-- Bug reports raised from the register by the person who hit the problem.

CREATE TABLE "PosBugReport" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "screen" TEXT,
    "orderId" TEXT,
    "appVersion" TEXT,
    "userAgent" TEXT,
    "reportedBy" TEXT,
    "clientError" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosBugReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PosBugReport_status_createdAt_idx" ON "PosBugReport"("status", "createdAt");
