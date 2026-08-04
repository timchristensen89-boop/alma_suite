-- Real open shifts.
--
-- RosterShift.staffProfileId becomes nullable: NULL means the shift is open,
-- nobody is on it yet. Until now "open" was faked by assigning shifts to
-- placeholder staff profiles named Unallocated, which put fake people in the
-- team list, the readiness counts and the pay reports.
--
-- Widening a NOT NULL column to nullable cannot fail on existing rows, and
-- every current row keeps its value.
ALTER TABLE "RosterShift" ALTER COLUMN "staffProfileId" DROP NOT NULL;

-- Claims: a staff member putting their hand up. A claim is a REQUEST, not an
-- assignment — two people may claim the same shift and a manager decides.
CREATE TABLE IF NOT EXISTS "roster_shift_claims" (
  "id"              TEXT NOT NULL,
  "rosterShiftId"   TEXT NOT NULL,
  "staffProfileId"  TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "note"            TEXT,
  "decidedAt"       TIMESTAMP(3),
  "decidedByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "roster_shift_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "roster_shift_claims_rosterShiftId_staffProfileId_key"
  ON "roster_shift_claims"("rosterShiftId", "staffProfileId");
CREATE INDEX IF NOT EXISTS "roster_shift_claims_staffProfileId_status_idx"
  ON "roster_shift_claims"("staffProfileId", "status");

ALTER TABLE "roster_shift_claims" ADD CONSTRAINT "roster_shift_claims_rosterShiftId_fkey"
  FOREIGN KEY ("rosterShiftId") REFERENCES "RosterShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "roster_shift_claims" ADD CONSTRAINT "roster_shift_claims_staffProfileId_fkey"
  FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Convert the placeholder workaround to genuine open shifts.
--
-- Safe because every one of these shifts already carries its own roleTitle and
-- area, so nothing the placeholder encoded is lost: the placeholder's surname
-- ("Bar", "Kitchen", "Floor Day") duplicated what the shift already stored.
-- Verified on production before writing this: 346 shifts, 0 missing roleTitle,
-- 0 missing area.
UPDATE "RosterShift" rs
SET "staffProfileId" = NULL
FROM "StaffProfile" sp
WHERE sp.id = rs."staffProfileId"
  AND (sp."firstName" = 'Unallocated' OR sp.notes LIKE '%unallocated placeholder%');

-- Retire the placeholders themselves so they stop appearing as people.
UPDATE "StaffProfile"
SET "employmentStatus" = 'ARCHIVED'
WHERE ("firstName" = 'Unallocated' OR notes LIKE '%unallocated placeholder%')
  AND "employmentStatus" <> 'ARCHIVED';
