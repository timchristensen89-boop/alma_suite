-- KDS tickets: persisted fired dockets with bump state.
CREATE TABLE "PosTicket" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" INTEGER NOT NULL,
    "tableLabel" TEXT,
    "covers" INTEGER,
    "openedByName" TEXT,
    "lines" JSONB NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bumpedAt" TIMESTAMP(3),
    CONSTRAINT "PosTicket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PosTicket_venue_station_bumpedAt_idx" ON "PosTicket"("venue", "station", "bumpedAt");
