CREATE TABLE "SquareCatalogItem" (
  "id" TEXT NOT NULL,
  "accountKey" TEXT NOT NULL,
  "squareItemId" TEXT NOT NULL,
  "squareVariationId" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL,
  "variationName" TEXT,
  "categoryName" TEXT,
  "sku" TEXT,
  "priceMoneyAmount" INTEGER,
  "currency" TEXT,
  "enabledLocationIds" JSONB NOT NULL DEFAULT '[]',
  "raw" JSONB NOT NULL DEFAULT '{}',
  "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SquareCatalogItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SquareMenuRecipeMapping" (
  "id" TEXT NOT NULL,
  "accountKey" TEXT NOT NULL,
  "venue" TEXT,
  "squareItemId" TEXT NOT NULL,
  "squareVariationId" TEXT NOT NULL DEFAULT '',
  "squareItemName" TEXT NOT NULL,
  "squareVariationName" TEXT,
  "categoryName" TEXT,
  "priceMoneyAmount" INTEGER,
  "currency" TEXT,
  "almaRecipeId" TEXT,
  "stockItemId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'UNMAPPED',
  "confidence" DOUBLE PRECISION,
  "notes" TEXT,
  "mappedAt" TIMESTAMP(3),
  "mappedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SquareMenuRecipeMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SquareCatalogItem_accountKey_squareItemId_squareVariationId_key"
  ON "SquareCatalogItem"("accountKey", "squareItemId", "squareVariationId");
CREATE INDEX "SquareCatalogItem_accountKey_isDeleted_idx" ON "SquareCatalogItem"("accountKey", "isDeleted");
CREATE INDEX "SquareCatalogItem_name_idx" ON "SquareCatalogItem"("name");
CREATE INDEX "SquareCatalogItem_categoryName_idx" ON "SquareCatalogItem"("categoryName");
CREATE INDEX "SquareCatalogItem_syncedAt_idx" ON "SquareCatalogItem"("syncedAt");

CREATE UNIQUE INDEX "SquareMenuRecipeMapping_accountKey_squareItemId_squareVariationId_key"
  ON "SquareMenuRecipeMapping"("accountKey", "squareItemId", "squareVariationId");
CREATE INDEX "SquareMenuRecipeMapping_accountKey_status_idx" ON "SquareMenuRecipeMapping"("accountKey", "status");
CREATE INDEX "SquareMenuRecipeMapping_almaRecipeId_idx" ON "SquareMenuRecipeMapping"("almaRecipeId");
CREATE INDEX "SquareMenuRecipeMapping_stockItemId_idx" ON "SquareMenuRecipeMapping"("stockItemId");
CREATE INDEX "SquareMenuRecipeMapping_venue_idx" ON "SquareMenuRecipeMapping"("venue");
CREATE INDEX "SquareMenuRecipeMapping_squareItemName_idx" ON "SquareMenuRecipeMapping"("squareItemName");

ALTER TABLE "SquareMenuRecipeMapping"
  ADD CONSTRAINT "SquareMenuRecipeMapping_almaRecipeId_fkey"
  FOREIGN KEY ("almaRecipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SquareMenuRecipeMapping"
  ADD CONSTRAINT "SquareMenuRecipeMapping_stockItemId_fkey"
  FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
