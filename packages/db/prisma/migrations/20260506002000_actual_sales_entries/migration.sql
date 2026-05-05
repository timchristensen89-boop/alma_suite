CREATE TABLE "SalesActualEntry" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "salesCents" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    "notes" TEXT,
    "importedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesActualEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesActualEntry_venue_serviceDate_source_externalId_key" ON "SalesActualEntry"("venue", "serviceDate", "source", "externalId");
CREATE INDEX "SalesActualEntry_serviceDate_idx" ON "SalesActualEntry"("serviceDate");
CREATE INDEX "SalesActualEntry_venue_serviceDate_idx" ON "SalesActualEntry"("venue", "serviceDate");
