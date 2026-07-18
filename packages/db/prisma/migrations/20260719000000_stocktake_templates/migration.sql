-- Reusable stocktake templates (base area/category selection + item tweaks)
CREATE TABLE "StocktakeTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "venue" TEXT,
    "blindDefault" BOOLEAN NOT NULL DEFAULT true,
    "countAreas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "includeItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludeItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StocktakeTemplate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StocktakeTemplate_venue_idx" ON "StocktakeTemplate"("venue");
CREATE INDEX "StocktakeTemplate_active_idx" ON "StocktakeTemplate"("active");
