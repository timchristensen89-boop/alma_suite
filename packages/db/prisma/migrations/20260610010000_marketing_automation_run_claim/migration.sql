-- Concurrency claim for the marketing-automation runner. Set to NOW() while a run
-- is in progress so a scheduler retry / overlapping invocation no-ops; reclaimable
-- after 1h if a run crashed mid-flight.
ALTER TABLE "AppSettings" ADD COLUMN "marketingAutomationRunAt" TIMESTAMP(3);
