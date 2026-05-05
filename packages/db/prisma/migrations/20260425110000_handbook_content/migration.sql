-- Store handbook content overrides on the settings singleton.
ALTER TABLE "AppSettings"
  ADD COLUMN "handbookContent" JSONB NOT NULL DEFAULT '{}'::jsonb;
