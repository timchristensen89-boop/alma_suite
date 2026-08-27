-- Per-venue POS till settings.
-- IF NOT EXISTS because 20260809150000_pos_venue_identity sorts earlier and
-- now creates this table too. See the ordering note in that migration.
CREATE TABLE IF NOT EXISTS "PosVenueSetting" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "postToReports" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PosVenueSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PosVenueSetting_venue_key" ON "PosVenueSetting"("venue");
