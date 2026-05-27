-- Loaded replacement cutover tracking.
-- Stores the LoadedCutoverCheck state map keyed by check id, plus any
-- comparison data the admin enters during parallel runs. Shape lives in
-- apps/api/src/services/loaded-replacement.service.ts.
ALTER TABLE "AppSettings" ADD COLUMN "loadedCutoverState" JSONB NOT NULL DEFAULT '{}'::jsonb;
