-- Noticeboard: tag each SuiteAnnouncement with a board (STAFF or AGISTMENT).
ALTER TABLE "SuiteAnnouncement" ADD COLUMN "board" TEXT NOT NULL DEFAULT 'STAFF';

CREATE INDEX "SuiteAnnouncement_board_deletedAt_pinned_createdAt_idx"
  ON "SuiteAnnouncement"("board", "deletedAt", "pinned", "createdAt");
