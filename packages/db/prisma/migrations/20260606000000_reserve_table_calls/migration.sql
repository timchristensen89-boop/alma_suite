-- Live service-map table calls (water / clear / check / attention / custom).

-- CreateEnum
CREATE TYPE "ReserveTableCallType" AS ENUM ('WATER', 'CLEAR', 'ORDER', 'CHECK', 'ATTENTION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReserveTableCallStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateTable
CREATE TABLE "ReserveTableCall" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "tableId" TEXT,
    "tableLabel" TEXT NOT NULL,
    "reservationId" TEXT,
    "type" "ReserveTableCallType" NOT NULL DEFAULT 'ATTENTION',
    "message" TEXT,
    "status" "ReserveTableCallStatus" NOT NULL DEFAULT 'OPEN',
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedByName" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByName" TEXT,

    CONSTRAINT "ReserveTableCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReserveTableCall_venue_status_createdAt_idx" ON "ReserveTableCall"("venue", "status", "createdAt");
