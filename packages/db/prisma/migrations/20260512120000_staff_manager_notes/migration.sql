CREATE TABLE "StaffManagerNote" (
    "id" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffManagerNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffManagerNote_staffProfileId_createdAt_idx" ON "StaffManagerNote"("staffProfileId", "createdAt");
CREATE INDEX "StaffManagerNote_createdById_idx" ON "StaffManagerNote"("createdById");

ALTER TABLE "StaffManagerNote" ADD CONSTRAINT "StaffManagerNote_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
