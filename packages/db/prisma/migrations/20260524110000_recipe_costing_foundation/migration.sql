ALTER TABLE "Recipe"
  ADD COLUMN "salePriceCents" INTEGER,
  ADD COLUMN "portionSize" DOUBLE PRECISION,
  ADD COLUMN "portionUnit" TEXT,
  ADD COLUMN "isPrepRecipe" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';

UPDATE "Recipe"
SET "isPrepRecipe" = true
WHERE "category" = 'Production Recipes'
   OR lower(coalesce("subcategory", '')) LIKE '%prep%'
   OR lower(coalesce("notes", '')) LIKE '%production recipe%';

ALTER TABLE "RecipeLine"
  ADD COLUMN "wastePercent" DOUBLE PRECISION;

CREATE INDEX "Recipe_isPrepRecipe_idx" ON "Recipe"("isPrepRecipe");
CREATE INDEX "Recipe_status_idx" ON "Recipe"("status");
