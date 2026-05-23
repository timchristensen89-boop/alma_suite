CREATE TABLE "SalesItemActualEntry" (
  "id" TEXT NOT NULL,
  "venue" TEXT NOT NULL,
  "serviceDate" TIMESTAMP(3) NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "externalId" TEXT NOT NULL,
  "itemName" TEXT NOT NULL,
  "variationName" TEXT,
  "categoryName" TEXT,
  "sku" TEXT,
  "catalogObjectId" TEXT,
  "catalogVersion" TEXT,
  "locationId" TEXT,
  "locationName" TEXT,
  "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "grossSalesCents" INTEGER NOT NULL DEFAULT 0,
  "netSalesCents" INTEGER NOT NULL DEFAULT 0,
  "orderCount" INTEGER NOT NULL DEFAULT 0,
  "lineCount" INTEGER NOT NULL DEFAULT 0,
  "recipeId" TEXT,
  "notes" TEXT,
  "sourceMetadata" JSONB NOT NULL DEFAULT '{}',
  "importedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SalesItemActualEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesItemActualEntry_venue_serviceDate_source_externalId_key"
  ON "SalesItemActualEntry"("venue", "serviceDate", "source", "externalId");

CREATE INDEX "SalesItemActualEntry_serviceDate_idx" ON "SalesItemActualEntry"("serviceDate");
CREATE INDEX "SalesItemActualEntry_venue_serviceDate_idx" ON "SalesItemActualEntry"("venue", "serviceDate");
CREATE INDEX "SalesItemActualEntry_source_catalogObjectId_idx" ON "SalesItemActualEntry"("source", "catalogObjectId");
CREATE INDEX "SalesItemActualEntry_recipeId_idx" ON "SalesItemActualEntry"("recipeId");
CREATE INDEX "SalesItemActualEntry_itemName_idx" ON "SalesItemActualEntry"("itemName");

ALTER TABLE "SalesItemActualEntry"
  ADD CONSTRAINT "SalesItemActualEntry_recipeId_fkey"
  FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
