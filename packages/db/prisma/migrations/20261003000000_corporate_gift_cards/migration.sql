-- Corporate gift cards v1: accounts, bulk orders, and pool-card linkage on GiftCard.
--
-- Additive only. Every new GiftCard column is nullable with no default, so
-- the ALTER is a catalog-only change on Postgres (no table rewrite) and every
-- existing row keeps NULL corporate linkage. Nothing here reads or rewrites
-- historical cards.

-- CreateEnum
CREATE TYPE "GiftCardAllocationStatus" AS ENUM ('UNALLOCATED', 'ALLOCATED');

-- CreateEnum
CREATE TYPE "CorporateOrderStatus" AS ENUM ('AWAITING_PAYMENT', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CorporatePaymentStatus" AS ENUM ('AWAITING_PAYMENT', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CorporatePaymentMethod" AS ENUM ('STRIPE', 'MANUAL_OFFLINE', 'INVOICE');

-- CreateEnum
CREATE TYPE "CorporateDiscountSource" AS ENUM ('NONE', 'GLOBAL_TIER', 'ACCOUNT_OVERRIDE');

-- AlterTable
ALTER TABLE "GiftCard" ADD COLUMN     "allocatedAt" TIMESTAMP(3),
ADD COLUMN     "allocatedById" TEXT,
ADD COLUMN     "allocationKey" TEXT,
ADD COLUMN     "allocationReference" TEXT,
ADD COLUMN     "allocationStatus" "GiftCardAllocationStatus",
ADD COLUMN     "corporateOrderId" TEXT;

-- CreateTable
CREATE TABLE "CorporateAccount" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "tradingName" TEXT,
    "abn" TEXT,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "accountsEmail" TEXT,
    "billingAddress" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "discountOverrideBps" INTEGER,
    "minimumQuantityOverride" INTEGER,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorporateAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporateGiftCardOrder" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "corporateAccountId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "faceValueCents" INTEGER NOT NULL,
    "faceValueTotalCents" INTEGER NOT NULL,
    "discountSource" "CorporateDiscountSource" NOT NULL DEFAULT 'NONE',
    "discountBps" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "amountDueCents" INTEGER NOT NULL,
    "serviceFeeCents" INTEGER NOT NULL DEFAULT 0,
    "pricingSnapshot" JSONB NOT NULL DEFAULT '{}',
    "paymentMethod" "CorporatePaymentMethod" NOT NULL,
    "paymentStatus" "CorporatePaymentStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "status" "CorporateOrderStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "tender" TEXT,
    "paymentReference" TEXT,
    "amountPaidCents" INTEGER,
    "paidAt" TIMESTAMP(3),
    "paymentRecordedById" TEXT,
    "issuedAt" TIMESTAMP(3),
    "poNumber" TEXT,
    "customerReference" TEXT,
    "defaultMessage" TEXT,
    "internalNote" TEXT,
    "clientRequestId" TEXT,
    "testMode" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorporateGiftCardOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CorporateAccount_active_idx" ON "CorporateAccount"("active");

-- CreateIndex
CREATE INDEX "CorporateAccount_companyName_idx" ON "CorporateAccount"("companyName");

-- CreateIndex
CREATE UNIQUE INDEX "CorporateGiftCardOrder_number_key" ON "CorporateGiftCardOrder"("number");

-- CreateIndex
CREATE UNIQUE INDEX "CorporateGiftCardOrder_stripeCheckoutSessionId_key" ON "CorporateGiftCardOrder"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CorporateGiftCardOrder_clientRequestId_key" ON "CorporateGiftCardOrder"("clientRequestId");

-- CreateIndex
CREATE INDEX "CorporateGiftCardOrder_corporateAccountId_createdAt_idx" ON "CorporateGiftCardOrder"("corporateAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "CorporateGiftCardOrder_status_idx" ON "CorporateGiftCardOrder"("status");

-- CreateIndex
CREATE INDEX "CorporateGiftCardOrder_paymentStatus_idx" ON "CorporateGiftCardOrder"("paymentStatus");

-- CreateIndex
CREATE INDEX "GiftCard_corporateOrderId_allocationStatus_idx" ON "GiftCard"("corporateOrderId", "allocationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_corporateOrderId_allocationKey_key" ON "GiftCard"("corporateOrderId", "allocationKey");

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_corporateOrderId_fkey" FOREIGN KEY ("corporateOrderId") REFERENCES "CorporateGiftCardOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporateGiftCardOrder" ADD CONSTRAINT "CorporateGiftCardOrder_corporateAccountId_fkey" FOREIGN KEY ("corporateAccountId") REFERENCES "CorporateAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

