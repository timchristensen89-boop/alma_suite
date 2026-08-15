-- Who switched this account off? Twice it went untraced because nothing recorded it.
CREATE TABLE "StaffStatusChange" (
  "id" TEXT NOT NULL,
  "staffProfileId" TEXT NOT NULL,
  "fromStatus" TEXT NOT NULL,
  "toStatus" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'unknown',
  "stack" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffStatusChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StaffStatusChange_staffProfileId_idx" ON "StaffStatusChange"("staffProfileId");
CREATE INDEX "StaffStatusChange_createdAt_idx" ON "StaffStatusChange"("createdAt");
