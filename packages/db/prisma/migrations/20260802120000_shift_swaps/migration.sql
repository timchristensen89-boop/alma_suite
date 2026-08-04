-- Shift swaps.
--
-- A swap is not a new kind of record: it is an existing shift whose holder has
-- offered it to the team. Marking the offer on the shift itself means the
-- claim machinery built for open shifts — the clash and leave guards, and the
-- single transaction that assigns one person and closes everyone else out —
-- applies to swaps unchanged.
--
-- offeredAt being set is what makes a shift visible to others.
-- offeredByStaffProfileId records who offered it, so a manager reassigning a
-- shift while its offer is live cannot make it read as though the new holder
-- offered their own shift away.
ALTER TABLE "RosterShift" ADD COLUMN IF NOT EXISTS "offeredAt" TIMESTAMP(3);
ALTER TABLE "RosterShift" ADD COLUMN IF NOT EXISTS "offeredByStaffProfileId" TEXT;
ALTER TABLE "RosterShift" ADD COLUMN IF NOT EXISTS "offerNote" TEXT;

-- ON DELETE SET NULL, not CASCADE: deleting the person who offered a shift
-- must not delete the shift itself. Somebody still has to work it.
ALTER TABLE "RosterShift" ADD CONSTRAINT "RosterShift_offeredByStaffProfileId_fkey"
  FOREIGN KEY ("offeredByStaffProfileId") REFERENCES "StaffProfile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Finding live offers is the hot path for the staff-facing list.
CREATE INDEX IF NOT EXISTS "RosterShift_offeredAt_idx" ON "RosterShift"("offeredAt");
