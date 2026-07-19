-- CreateTable
CREATE TABLE "SupplierInvoiceDocument" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "fileName" TEXT,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvoiceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoiceDocument_invoiceId_key" ON "SupplierInvoiceDocument"("invoiceId");

-- AddForeignKey
ALTER TABLE "SupplierInvoiceDocument" ADD CONSTRAINT "SupplierInvoiceDocument_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
