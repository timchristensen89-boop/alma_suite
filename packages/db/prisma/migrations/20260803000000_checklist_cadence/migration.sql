-- Checklist templates gain a cadence so the daily scheduler stops raising a
-- run from every template every day. Existing rows default to DAILY, then the
-- ones that are plainly not daily are corrected below.
ALTER TABLE "ChecklistTemplate" ADD COLUMN "cadence" TEXT NOT NULL DEFAULT 'DAILY';
ALTER TABLE "ChecklistTemplate" ADD COLUMN "cadenceDay" INTEGER;

-- SOP reviews are documents someone reads when something changes, not a task
-- for every shift. Raising them daily is what would bury the real checklists.
UPDATE "ChecklistTemplate" SET "cadence" = 'MANUAL'
 WHERE "name" ILIKE '%- Review' OR "area" IN ('SOP', 'Management');

-- One template says weekly in its own name.
UPDATE "ChecklistTemplate" SET "cadence" = 'WEEKLY', "cadenceDay" = 1
 WHERE "name" ILIKE 'Weekly %';
