-- Drinks pre-payment: admin-defined packages + per-reservation prepaid record.

CREATE TABLE "ReserveDrinkPackage" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReserveDrinkPackage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReserveDrinkPackage_venue_name_key" ON "ReserveDrinkPackage"("venue", "name");
CREATE INDEX "ReserveDrinkPackage_venue_isActive_sortOrder_idx" ON "ReserveDrinkPackage"("venue", "isActive", "sortOrder");

ALTER TABLE "ReserveReservation" ADD COLUMN "drinksLineItems" JSONB;
ALTER TABLE "ReserveReservation" ADD COLUMN "drinksTotalCents" INTEGER;
ALTER TABLE "ReserveReservation" ADD COLUMN "drinksPaymentIntentId" TEXT;
ALTER TABLE "ReserveReservation" ADD COLUMN "drinksPaidAt" TIMESTAMP(3);
ALTER TABLE "ReserveReservation" ADD COLUMN "drinksRedeemedAt" TIMESTAMP(3);
ALTER TABLE "ReserveReservation" ADD COLUMN "drinksPaymentError" TEXT;
