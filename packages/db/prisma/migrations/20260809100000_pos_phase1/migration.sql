-- POS Phase 1: modifiers, 86 list, seats, hold&fire, landing category.
CREATE TABLE "PosModifierGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoriesCsv" TEXT NOT NULL DEFAULT '',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "maxSelect" INTEGER NOT NULL DEFAULT 3,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "PosModifierGroup_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PosModifier" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "PosModifier_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PosModifier_groupId_idx" ON "PosModifier"("groupId");
ALTER TABLE "PosModifier" ADD CONSTRAINT "PosModifier_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PosModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Pos86" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "staffName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Pos86_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Pos86_recipeId_key" ON "Pos86"("recipeId");

ALTER TABLE "PosOrderLine" ADD COLUMN "seat" INTEGER;
ALTER TABLE "PosOrderLine" ADD COLUMN "modifiers" JSONB;
ALTER TABLE "PosHomescreen" ADD COLUMN "landingCategory" TEXT;
