-- AlterEnum (must not run inside a transaction block)
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'SEVENROOMS';

-- AlterTable
ALTER TABLE "ReserveReservation" ADD COLUMN "externalRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ReserveReservation_externalRef_key" ON "ReserveReservation"("externalRef");
