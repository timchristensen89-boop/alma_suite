-- Deputy leave timesheets carry their flag into the suite, so payroll and
-- tips can tell leave from worked hours.
ALTER TABLE "Timesheet" ADD COLUMN IF NOT EXISTS "isLeave" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Timesheet" ADD COLUMN IF NOT EXISTS "leaveKind" TEXT;
