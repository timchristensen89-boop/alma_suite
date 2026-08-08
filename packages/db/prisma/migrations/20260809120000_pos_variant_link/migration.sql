CREATE TABLE "PosVariantLink" (
    "id" TEXT NOT NULL,
    "parentRecipeId" TEXT NOT NULL,
    "childRecipeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PosVariantLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PosVariantLink_childRecipeId_key" ON "PosVariantLink"("childRecipeId");
CREATE INDEX "PosVariantLink_parentRecipeId_idx" ON "PosVariantLink"("parentRecipeId");
