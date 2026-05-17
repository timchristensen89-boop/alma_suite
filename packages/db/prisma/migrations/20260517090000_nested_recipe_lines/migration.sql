-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN "yieldQuantity" DOUBLE PRECISION;
ALTER TABLE "Recipe" ADD COLUMN "yieldUnit" TEXT;

-- AlterTable
ALTER TABLE "RecipeLine" ADD COLUMN "subRecipeId" TEXT;

-- CreateIndex
CREATE INDEX "RecipeLine_subRecipeId_idx" ON "RecipeLine"("subRecipeId");

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_subRecipeId_fkey" FOREIGN KEY ("subRecipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
