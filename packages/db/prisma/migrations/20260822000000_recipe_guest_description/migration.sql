-- What a guest reads under the dish name on the QR menu.
--
-- Kept apart from Recipe."notes", which is internal: prep reminders and
-- back-office asides that nobody intends a guest to see. Sharing one column
-- would mean every kitchen note was one rendering decision away from the
-- table, so the guest-facing copy gets its own.
--
-- NULL means no copy yet — the menu shows the dish name on its own.
ALTER TABLE "Recipe" ADD COLUMN "guestDescription" TEXT;
