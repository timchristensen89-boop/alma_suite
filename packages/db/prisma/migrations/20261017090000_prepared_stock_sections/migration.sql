-- Batch Cocktails and Kitchen Prep: prepared products counted as stock items.
-- Additive only: one nullable link and two category rows. No existing row changes.
ALTER TABLE "StockItem" ADD COLUMN "prepRecipeId" TEXT;
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_prepRecipeId_fkey" FOREIGN KEY ("prepRecipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "StockItem_prepRecipeId_idx" ON "StockItem"("prepRecipeId");

INSERT INTO "StockCategory" ("id", "name", "description", "createdAt", "updatedAt") VALUES
  ('cat_batch_cocktails', 'Batch Cocktails', 'Pre-made cocktail batches, counted by volume or container', now(), now()),
  ('cat_kitchen_prep', 'Kitchen Prep', 'Kitchen preparations (salsas, sauces, marinades), counted by weight, volume or container', now(), now())
ON CONFLICT ("name") DO NOTHING;
