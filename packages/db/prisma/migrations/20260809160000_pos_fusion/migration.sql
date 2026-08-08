-- Per-venue POS till settings.
CREATE TABLE "PosVenueSetting" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "postToReports" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PosVenueSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PosVenueSetting_venue_key" ON "PosVenueSetting"("venue");
