-- Leave reaches Xero with the week's timesheets, so one absence becomes one
-- application per pay period. Keyed on (leaveRequestId, tenantId) alone, the
-- second week of a long absence collided with the first and could never be
-- sent. The period is part of the identity.
--
-- Safe as a drop-and-recreate: the table was added hours ago by
-- 20260831000000_xero_leave_link and holds no rows — the push that would have
-- written to it has never been run.
ALTER TABLE "StaffXeroLeave"
    ADD COLUMN "periodStart" TIMESTAMP(3),
    ADD COLUMN "periodEnd"   TIMESTAMP(3);

-- Any row that somehow exists predates per-period pushing; give it the
-- application's own span so the column can be made NOT NULL.
UPDATE "StaffXeroLeave" SET "periodStart" = "createdAt" WHERE "periodStart" IS NULL;
UPDATE "StaffXeroLeave" SET "periodEnd"   = "createdAt" WHERE "periodEnd"   IS NULL;

ALTER TABLE "StaffXeroLeave"
    ALTER COLUMN "periodStart" SET NOT NULL,
    ALTER COLUMN "periodEnd"   SET NOT NULL;

DROP INDEX IF EXISTS "StaffXeroLeave_leaveRequestId_tenantId_key";

CREATE UNIQUE INDEX "StaffXeroLeave_leaveRequestId_tenantId_periodStart_key"
    ON "StaffXeroLeave"("leaveRequestId", "tenantId", "periodStart");
