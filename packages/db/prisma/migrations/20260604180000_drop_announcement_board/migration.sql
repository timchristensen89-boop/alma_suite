-- Revert the noticeboard "board" tag (agistment moved to the Kavalley repo).
-- Run AFTER the API revision that no longer references "board" is live.
DROP INDEX IF EXISTS "SuiteAnnouncement_board_deletedAt_pinned_createdAt_idx";
ALTER TABLE "SuiteAnnouncement" DROP COLUMN IF EXISTS "board";
