-- CreateTable: bookable areas per venue (admin-editable; deactivate via isActive).
CREATE TABLE "ReserveArea" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReserveArea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReserveArea_venue_name_key" ON "ReserveArea"("venue", "name");
CREATE INDEX "ReserveArea_venue_isActive_sortOrder_idx" ON "ReserveArea"("venue", "isActive", "sortOrder");

-- AlterTable: capture the chosen area on a reservation.
ALTER TABLE "ReserveReservation" ADD COLUMN "area" TEXT;

-- Seed the initial bookable areas for each venue (idempotent).
INSERT INTO "ReserveArea" ("id", "venue", "name", "sortOrder", "isActive", "createdAt", "updatedAt") VALUES
  ('rsva_avalon_inside',  'Alma Avalon', 'Inside',          0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rsva_avalon_outside', 'Alma Avalon', 'Outside',         1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rsva_avalon_bar',     'Alma Avalon', 'Bar',             2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rsva_stalma_dining',  'St Alma',     'Dining Room',     0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rsva_stalma_barctr',  'St Alma',     'Bar Counter',     1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rsva_stalma_kitctr',  'St Alma',     'Kitchen Counter', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("venue", "name") DO NOTHING;
