-- POS v2: tables/covers, courses, split bills, surcharge/discount rules.
ALTER TABLE "PosOrder" ADD COLUMN "discountLabel" TEXT;
ALTER TABLE "PosOrder" ADD COLUMN "surchargeCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PosOrder" ADD COLUMN "surchargeLabel" TEXT;
ALTER TABLE "PosOrder" ADD COLUMN "tableLabel" TEXT;
ALTER TABLE "PosOrder" ADD COLUMN "covers" INTEGER;
ALTER TABLE "PosOrderLine" ADD COLUMN "course" TEXT;
CREATE TABLE "PosRule" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "percent" DOUBLE PRECISION NOT NULL,
    "weekdays" TEXT NOT NULL,
    "holidays" BOOLEAN NOT NULL DEFAULT false,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PosRule_pkey" PRIMARY KEY ("id")
);
