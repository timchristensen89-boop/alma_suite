-- The print bridge announces itself once a minute — one row per venue, so
-- the Office can show whether dockets have a working path, and where the
-- box driving them actually is (no more hunting the Pi across venue wifi).

-- CreateTable
CREATE TABLE "PosPrintBridge" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "hostname" TEXT,
    "lanIps" TEXT,
    "version" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosPrintBridge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PosPrintBridge_venue_key" ON "PosPrintBridge"("venue");
