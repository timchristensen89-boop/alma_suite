CREATE TYPE "StaffAccountType" AS ENUM ('HUMAN', 'VENUE_DEVICE');

ALTER TABLE "StaffProfile"
ADD COLUMN "accountType" "StaffAccountType" NOT NULL DEFAULT 'HUMAN',
ADD COLUMN "pinHash" TEXT,
ADD COLUMN "pinUpdatedAt" TIMESTAMP(3);

CREATE INDEX "StaffProfile_accountType_venue_idx" ON "StaffProfile"("accountType", "venue");
