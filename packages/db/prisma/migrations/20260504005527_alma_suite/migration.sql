-- DropIndex
DROP INDEX IF EXISTS "StaffProfile_venue_idx";

-- DropIndex
DROP INDEX IF EXISTS "StaffProfile_xeroEmployeeId_idx";

-- AlterTable
ALTER TABLE "AppSettings" ALTER COLUMN "goveeBaseUrl" SET DEFAULT 'https://openapi.api.govee.com';

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT,
    "lga" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Venue_name_key" ON "Venue"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_slug_key" ON "Venue"("slug");
