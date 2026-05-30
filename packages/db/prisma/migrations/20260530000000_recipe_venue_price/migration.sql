-- CreateTable
CREATE TABLE "RecipeVenuePrice" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "salePriceCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipeVenuePrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecipeVenuePrice_recipeId_idx" ON "RecipeVenuePrice"("recipeId");

-- CreateIndex
CREATE INDEX "RecipeVenuePrice_venue_idx" ON "RecipeVenuePrice"("venue");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeVenuePrice_recipeId_venue_key" ON "RecipeVenuePrice"("recipeId", "venue");

-- AddForeignKey
ALTER TABLE "RecipeVenuePrice" ADD CONSTRAINT "RecipeVenuePrice_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
