-- Chase-up state for onboarding invites.
-- 20 of 33 invites expired unused with nobody told; these columns let a daily
-- job nudge the starter twice and then report the dead ones, without resending
-- the same reminder every day.
ALTER TABLE "StaffInvite" ADD COLUMN "remindersSent" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "StaffInvite" ADD COLUMN "managerAlertAt" TIMESTAMP(3);
CREATE INDEX "StaffInvite_completedAt_expiresAt_idx" ON "StaffInvite"("completedAt", "expiresAt");
