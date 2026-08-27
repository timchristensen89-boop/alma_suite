-- Weekday price windows: Taco Tuesday's $5 tacos and the Tuesday-only taco
-- board, applied automatically by day instead of re-keyed by hand.
CREATE TABLE IF NOT EXISTS "PosPriceWindow" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "weekdays" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "onlyWindow" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosPriceWindow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PosPriceWindow_recipeId_idx" ON "PosPriceWindow"("recipeId");
