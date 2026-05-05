-- CreateEnum
CREATE TYPE "ReserveReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "ReserveServicePeriod" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'EVENT');

-- CreateTable
CREATE TABLE "ReserveGuest" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allergyNotes" TEXT,
    "visitNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReserveGuest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReserveTable" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "minCovers" INTEGER NOT NULL DEFAULT 1,
    "maxCovers" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReserveTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReserveReservation" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "servicePeriod" "ReserveServicePeriod" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "covers" INTEGER NOT NULL,
    "status" "ReserveReservationStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'manager',
    "tableId" TEXT,
    "guestId" TEXT NOT NULL,
    "occasion" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReserveReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReserveGuest_lastName_firstName_idx" ON "ReserveGuest"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "ReserveGuest_email_idx" ON "ReserveGuest"("email");

-- CreateIndex
CREATE INDEX "ReserveGuest_phone_idx" ON "ReserveGuest"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "ReserveTable_venue_label_key" ON "ReserveTable"("venue", "label");

-- CreateIndex
CREATE INDEX "ReserveTable_venue_area_sortOrder_idx" ON "ReserveTable"("venue", "area", "sortOrder");

-- CreateIndex
CREATE INDEX "ReserveTable_isActive_idx" ON "ReserveTable"("isActive");

-- CreateIndex
CREATE INDEX "ReserveReservation_venue_serviceDate_servicePeriod_idx" ON "ReserveReservation"("venue", "serviceDate", "servicePeriod");

-- CreateIndex
CREATE INDEX "ReserveReservation_startsAt_endsAt_idx" ON "ReserveReservation"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "ReserveReservation_status_serviceDate_idx" ON "ReserveReservation"("status", "serviceDate");

-- CreateIndex
CREATE INDEX "ReserveReservation_guestId_idx" ON "ReserveReservation"("guestId");

-- CreateIndex
CREATE INDEX "ReserveReservation_tableId_idx" ON "ReserveReservation"("tableId");

-- AddForeignKey
ALTER TABLE "ReserveReservation" ADD CONSTRAINT "ReserveReservation_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "ReserveGuest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReserveReservation" ADD CONSTRAINT "ReserveReservation_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "ReserveTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
