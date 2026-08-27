-- Receipt identity on a venue's POS settings.
--
-- ORDERING NOTE. This migration is timestamped 0809150000, which sorts BEFORE
-- 20260809160000_pos_fusion -- the migration that actually creates
-- "PosVenueSetting". On production that never mattered: pos_fusion was applied
-- first in wall-clock time, this one was authored afterwards, and `migrate
-- deploy` applies whatever is pending without re-sorting what is already done.
--
-- It matters on an EMPTY database, where the history really is replayed in
-- name order: this ran first, the table did not exist yet, and the whole chain
-- stopped here. That broke `pnpm db:migrate`, which is the documented way to
-- set up a new machine.
--
-- Renaming the directory would fix the order and stranded production, where
-- this name is recorded in _prisma_migrations. So instead both this migration
-- and pos_fusion were made order-independent: whichever runs first creates the
-- table, the other stands down. On production both halves are no-ops, because
-- the table and every column below already exist.
CREATE TABLE IF NOT EXISTS "PosVenueSetting" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "postToReports" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PosVenueSetting_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PosVenueSetting"
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "website" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptLogo" TEXT;
