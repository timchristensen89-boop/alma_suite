-- Prepped items in a stocktake.
--
-- A StocktakeLine may now point at a prep Recipe instead of a StockItem: what
-- the kitchen has already made, counted as itself (11.7 kg of chipotle mayo).
-- Applying the count explodes the recipe back into the raw items it consumed.
--
-- Both foreign keys stay nullable and are ON DELETE SET NULL, matching the
-- existing itemId behaviour: deleting a recipe must never take a historical
-- count with it.
ALTER TABLE "StocktakeLine" ADD COLUMN "recipeId" TEXT;

CREATE INDEX "StocktakeLine_recipeId_idx" ON "StocktakeLine"("recipeId");

ALTER TABLE "StocktakeLine"
  ADD CONSTRAINT "StocktakeLine_recipeId_fkey"
  FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Which prep recipes a saved count sheet carries.
ALTER TABLE "StocktakeTemplate" ADD COLUMN "prepRecipeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
