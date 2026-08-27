-- Agreed weekly hours for full-time / part-time staff (e.g. 38, 24).
-- The labour view measures rostered hours against this; NULL = not set.
ALTER TABLE "StaffProfile" ADD COLUMN "contractedWeeklyHours" INTEGER;
