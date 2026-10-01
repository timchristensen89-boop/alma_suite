-- Receipts, tax invoices and credit notes (Alma Suite invoicing).
--
-- New tables only, plus one defaulted JSON column on AppSettings. Nothing
-- existing is rewritten: no document exists until one is issued, and issuing
-- is off until an issuing company is chosen in the Invoices settings.
--
-- LegalEntity           the companies that can issue documents (name, ABN)
-- FinancialDocument     one issued document, immutable apart from email/void
-- FinancialDocumentLine its printed lines, each with its own GST treatment
-- FinancialDocumentSequence  gap-free numbering, one row per series

-- CreateEnum
CREATE TYPE "GstTreatment" AS ENUM ('STANDARD_TAXABLE', 'GST_FREE', 'INPUT_TAXED', 'FACE_VALUE_VOUCHER', 'MIXED');

-- CreateEnum
CREATE TYPE "FinancialDocumentType" AS ENUM ('RECEIPT', 'TAX_INVOICE', 'CREDIT_NOTE', 'ADJUSTMENT_NOTE');

-- CreateEnum
CREATE TYPE "FinancialDocumentStatus" AS ENUM ('ISSUED', 'VOID');

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "invoiceSettings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "LegalEntity" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradingName" TEXT,
    "abn" TEXT NOT NULL,
    "gstRegistered" BOOLEAN NOT NULL DEFAULT true,
    "address" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "documentPrefix" TEXT NOT NULL DEFAULT 'ALMA',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialDocument" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "FinancialDocumentType" NOT NULL,
    "status" "FinancialDocumentStatus" NOT NULL DEFAULT 'ISSUED',
    "gstTreatment" "GstTreatment" NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceReference" TEXT,
    "saleKey" TEXT,
    "giftCardId" TEXT,
    "creditsDocumentId" TEXT,
    "legalEntityId" TEXT NOT NULL,
    "issuerLegalName" TEXT NOT NULL,
    "issuerTradingName" TEXT,
    "issuerAbn" TEXT NOT NULL,
    "issuerAddress" TEXT,
    "issuerEmail" TEXT,
    "issuerPhone" TEXT,
    "issuerWebsite" TEXT,
    "issuerGstRegistered" BOOLEAN NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerOrganisation" TEXT,
    "customerAbn" TEXT,
    "customerEmail" TEXT,
    "customerReference" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'aud',
    "totalCents" INTEGER NOT NULL,
    "taxableCents" INTEGER NOT NULL,
    "gstCents" INTEGER NOT NULL,
    "paymentProvider" TEXT NOT NULL,
    "paymentReference" TEXT,
    "paymentMethodSummary" TEXT,
    "stripePaymentIntentId" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "stripeChargeId" TEXT,
    "stripeRefundId" TEXT,
    "stripeRefundLatch" TEXT,
    "clientRequestId" TEXT,
    "paidAt" TIMESTAMP(3),
    "supplyDate" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT,
    "issueSource" TEXT NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "emailedAt" TIMESTAMP(3),
    "emailedTo" TEXT,
    "emailError" TEXT,
    "emailCount" INTEGER NOT NULL DEFAULT 0,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "testMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialDocumentLine" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "detail" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitAmountCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "gstTreatment" "GstTreatment" NOT NULL,
    "taxableAmountCents" INTEGER NOT NULL,
    "gstCents" INTEGER NOT NULL,

    CONSTRAINT "FinancialDocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialDocumentSequence" (
    "series" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialDocumentSequence_pkey" PRIMARY KEY ("series")
);

-- CreateIndex
CREATE UNIQUE INDEX "LegalEntity_code_key" ON "LegalEntity"("code");

-- CreateIndex
CREATE INDEX "LegalEntity_active_idx" ON "LegalEntity"("active");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialDocument_number_key" ON "FinancialDocument"("number");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialDocument_saleKey_key" ON "FinancialDocument"("saleKey");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialDocument_stripeRefundLatch_key" ON "FinancialDocument"("stripeRefundLatch");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialDocument_clientRequestId_key" ON "FinancialDocument"("clientRequestId");

-- CreateIndex
CREATE INDEX "FinancialDocument_sourceType_sourceId_idx" ON "FinancialDocument"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "FinancialDocument_giftCardId_idx" ON "FinancialDocument"("giftCardId");

-- CreateIndex
CREATE INDEX "FinancialDocument_creditsDocumentId_idx" ON "FinancialDocument"("creditsDocumentId");

-- CreateIndex
CREATE INDEX "FinancialDocument_legalEntityId_idx" ON "FinancialDocument"("legalEntityId");

-- CreateIndex
CREATE INDEX "FinancialDocument_issuedAt_idx" ON "FinancialDocument"("issuedAt");

-- CreateIndex
CREATE INDEX "FinancialDocument_type_status_idx" ON "FinancialDocument"("type", "status");

-- CreateIndex
CREATE INDEX "FinancialDocument_customerEmail_idx" ON "FinancialDocument"("customerEmail");

-- CreateIndex
CREATE INDEX "FinancialDocument_stripePaymentIntentId_idx" ON "FinancialDocument"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "FinancialDocument_stripeRefundId_idx" ON "FinancialDocument"("stripeRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialDocument_series_sequence_key" ON "FinancialDocument"("series", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialDocumentLine_documentId_position_key" ON "FinancialDocumentLine"("documentId", "position");

-- AddForeignKey
ALTER TABLE "FinancialDocument" ADD CONSTRAINT "FinancialDocument_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialDocument" ADD CONSTRAINT "FinancialDocument_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialDocument" ADD CONSTRAINT "FinancialDocument_creditsDocumentId_fkey" FOREIGN KEY ("creditsDocumentId") REFERENCES "FinancialDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialDocumentLine" ADD CONSTRAINT "FinancialDocumentLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinancialDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

