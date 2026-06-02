-- CreateTable
CREATE TABLE "InvoiceExclusionRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceExclusionRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceExclusionRule_enabled_idx" ON "InvoiceExclusionRule"("enabled");
