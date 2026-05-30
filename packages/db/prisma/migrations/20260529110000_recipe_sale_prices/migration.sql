CREATE TABLE "RecipeSalePrice" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "salePriceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceAccountKey" TEXT,
    "sourceMappingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipeSalePrice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecipeSalePrice_recipeId_venue_key" ON "RecipeSalePrice"("recipeId", "venue");
CREATE INDEX "RecipeSalePrice_venue_idx" ON "RecipeSalePrice"("venue");
CREATE INDEX "RecipeSalePrice_sourceAccountKey_idx" ON "RecipeSalePrice"("sourceAccountKey");
CREATE INDEX "RecipeSalePrice_sourceMappingId_idx" ON "RecipeSalePrice"("sourceMappingId");

ALTER TABLE "RecipeSalePrice"
ADD CONSTRAINT "RecipeSalePrice_recipeId_fkey"
FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
