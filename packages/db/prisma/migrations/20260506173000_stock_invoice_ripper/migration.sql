-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'XERO',
    "invoiceKey" TEXT NOT NULL,
    "externalInvoiceId" TEXT,
    "invoiceNumber" TEXT,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "supplierEmail" TEXT,
    "venue" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "currencyCode" TEXT NOT NULL DEFAULT 'AUD',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "sourceFileName" TEXT,
    "sourceFileType" TEXT,
    "sourceMetadata" JSONB,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceLine" (
    "id" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "lineKey" TEXT NOT NULL,
    "externalLineId" TEXT,
    "description" TEXT NOT NULL,
    "itemCode" TEXT,
    "accountCode" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT,
    "unitAmountCents" INTEGER NOT NULL DEFAULT 0,
    "lineAmountCents" INTEGER NOT NULL DEFAULT 0,
    "taxAmountCents" INTEGER NOT NULL DEFAULT 0,
    "itemId" TEXT,
    "matchingStatus" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    "notes" TEXT,
    "sourceMetadata" JSONB,
    "costAppliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_source_invoiceKey_key" ON "SupplierInvoice"("source", "invoiceKey");

-- CreateIndex
CREATE INDEX "SupplierInvoice_venue_invoiceDate_idx" ON "SupplierInvoice"("venue", "invoiceDate");

-- CreateIndex
CREATE INDEX "SupplierInvoice_supplierId_invoiceDate_idx" ON "SupplierInvoice"("supplierId", "invoiceDate");

-- CreateIndex
CREATE INDEX "SupplierInvoice_externalInvoiceId_idx" ON "SupplierInvoice"("externalInvoiceId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_invoiceNumber_idx" ON "SupplierInvoice"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoiceLine_supplierInvoiceId_lineKey_key" ON "SupplierInvoiceLine"("supplierInvoiceId", "lineKey");

-- CreateIndex
CREATE INDEX "SupplierInvoiceLine_supplierInvoiceId_lineNumber_idx" ON "SupplierInvoiceLine"("supplierInvoiceId", "lineNumber");

-- CreateIndex
CREATE INDEX "SupplierInvoiceLine_itemId_idx" ON "SupplierInvoiceLine"("itemId");

-- CreateIndex
CREATE INDEX "SupplierInvoiceLine_matchingStatus_idx" ON "SupplierInvoiceLine"("matchingStatus");

-- CreateIndex
CREATE INDEX "SupplierInvoiceLine_itemCode_idx" ON "SupplierInvoiceLine"("itemCode");

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "StockItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
