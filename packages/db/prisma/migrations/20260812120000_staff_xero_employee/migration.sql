-- One Xero employee record per (staff member, organisation).
--
-- Alma Freshwater Pty Ltd (St Alma) and Alma Avalon are separate companies
-- with separate payrolls, so anyone working both is two employees in Xero.
-- StaffProfile.xeroEmployeeId held a single id with no record of which
-- company it belonged to.

CREATE TABLE "StaffXeroEmployee" (
    "id" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tenantName" TEXT,
    "xeroEmployeeId" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffXeroEmployee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffXeroEmployee_staffProfileId_tenantId_key"
    ON "StaffXeroEmployee"("staffProfileId", "tenantId");
CREATE INDEX "StaffXeroEmployee_tenantId_idx" ON "StaffXeroEmployee"("tenantId");
CREATE INDEX "StaffXeroEmployee_xeroEmployeeId_idx" ON "StaffXeroEmployee"("xeroEmployeeId");

ALTER TABLE "StaffXeroEmployee" ADD CONSTRAINT "StaffXeroEmployee_staffProfileId_fkey"
    FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
