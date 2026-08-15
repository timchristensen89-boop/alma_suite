-- POS v3: cash drawers, close-of-day audit, courses, printer profiles, sent lines.
CREATE TABLE "PosDrawer" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openingFloatCents" INTEGER NOT NULL DEFAULT 0,
    "countedCents" INTEGER,
    "expectedCents" INTEGER,
    "varianceCents" INTEGER,
    "denominations" JSONB,
    "openedByName" TEXT,
    "closedByName" TEXT,
    "notes" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "PosDrawer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PosDrawer_venue_status_idx" ON "PosDrawer"("venue", "status");

CREATE TABLE "PosDayClose" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "report" JSONB NOT NULL,
    "closedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PosDayClose_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PosDayClose_venue_serviceDate_key" ON "PosDayClose"("venue", "serviceDate");

CREATE TABLE "PosCourse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "PosCourse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PosCourse_name_key" ON "PosCourse"("name");

CREATE TABLE "PosPrinterProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "matchKind" TEXT NOT NULL,
    "categoriesCsv" TEXT NOT NULL DEFAULT '',
    "printerIp" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PosPrinterProfile_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PosOrderLine" ADD COLUMN "sentAt" TIMESTAMP(3);

ALTER TABLE "ReserveReservation" ADD COLUMN "tableLabels" TEXT;
