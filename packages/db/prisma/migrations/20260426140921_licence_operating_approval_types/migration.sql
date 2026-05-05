-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LiquorLicenceType" ADD VALUE 'OUTDOOR_SEATING';
ALTER TYPE "LiquorLicenceType" ADD VALUE 'FOOD_BUSINESS';
ALTER TYPE "LiquorLicenceType" ADD VALUE 'FOOTPATH_DINING';
ALTER TYPE "LiquorLicenceType" ADD VALUE 'MUSIC_ENTERTAINMENT';
ALTER TYPE "LiquorLicenceType" ADD VALUE 'SIGNAGE';
ALTER TYPE "LiquorLicenceType" ADD VALUE 'FIRE_SAFETY';
ALTER TYPE "LiquorLicenceType" ADD VALUE 'WASTE_TRADE';
