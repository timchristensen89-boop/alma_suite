-- One Alma leave request, as it landed in one Xero organisation.
--
-- A duplicate leave application in a live payroll is not undoable: it draws
-- the balance twice and pays it twice. The push reads this table before it
-- sends, so a second push is a no-op rather than a second application.
CREATE TABLE "StaffXeroLeave" (
    "id" TEXT NOT NULL,
    "leaveRequestId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tenantName" TEXT,
    "xeroLeaveApplicationId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "leaveTypeName" TEXT,
    "units" DOUBLE PRECISION NOT NULL,
    "unitsAre" TEXT NOT NULL,
    "pushedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffXeroLeave_pkey" PRIMARY KEY ("id")
);

-- The guard itself: one application per request per company.
CREATE UNIQUE INDEX "StaffXeroLeave_leaveRequestId_tenantId_key"
    ON "StaffXeroLeave"("leaveRequestId", "tenantId");

CREATE INDEX "StaffXeroLeave_tenantId_idx" ON "StaffXeroLeave"("tenantId");

ALTER TABLE "StaffXeroLeave"
    ADD CONSTRAINT "StaffXeroLeave_leaveRequestId_fkey"
    FOREIGN KEY ("leaveRequestId") REFERENCES "StaffLeaveRequest"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
