-- Link a timesheet back to the clock session that produced it.
-- Clocking off now raises the timesheet; the unique constraint makes that
-- idempotent, so a repeated clock-out or a manager correcting a session updates
-- the existing row rather than paying the same hours twice.
ALTER TABLE "Timesheet" ADD COLUMN "clockSessionId" TEXT;
CREATE UNIQUE INDEX "Timesheet_clockSessionId_key" ON "Timesheet"("clockSessionId");
