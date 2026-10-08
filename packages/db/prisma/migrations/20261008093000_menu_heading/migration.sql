-- Menu Editor: a per-version printed heading. Empty keeps the template's own
-- title ("À la carte"), so every existing version prints exactly as before.
ALTER TABLE "MenuVersion" ADD COLUMN "heading" TEXT NOT NULL DEFAULT '';
