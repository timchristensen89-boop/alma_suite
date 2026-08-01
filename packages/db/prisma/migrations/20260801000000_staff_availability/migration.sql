-- Staff availability: when someone can work, and one-off dates they cannot.
--
-- Additive only. No row means nothing has been stated, NOT unavailable, so a
-- venue that never fills these in rosters exactly as it does today.
CREATE TABLE IF NOT EXISTS "staff_availability" (
  "id"             TEXT NOT NULL,
  "staffProfileId" TEXT NOT NULL,
  "weekday"        INTEGER NOT NULL,
  "startMinute"    INTEGER,
  "endMinute"      INTEGER,
  "available"      BOOLEAN NOT NULL DEFAULT true,
  "note"           TEXT,
  "effectiveFrom"  TIMESTAMP(3),
  "effectiveTo"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_availability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "staff_unavailability" (
  "id"             TEXT NOT NULL,
  "staffProfileId" TEXT NOT NULL,
  "startsAt"       TIMESTAMP(3) NOT NULL,
  "endsAt"         TIMESTAMP(3) NOT NULL,
  "reason"         TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_unavailability_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "staff_availability_staffProfileId_weekday_idx" ON "staff_availability"("staffProfileId", "weekday");
CREATE INDEX IF NOT EXISTS "staff_unavailability_staffProfileId_startsAt_idx" ON "staff_unavailability"("staffProfileId", "startsAt");
CREATE INDEX IF NOT EXISTS "staff_unavailability_startsAt_endsAt_idx" ON "staff_unavailability"("startsAt", "endsAt");

ALTER TABLE "staff_availability" ADD CONSTRAINT "staff_availability_staffProfileId_fkey"
  FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_unavailability" ADD CONSTRAINT "staff_unavailability_staffProfileId_fkey"
  FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
