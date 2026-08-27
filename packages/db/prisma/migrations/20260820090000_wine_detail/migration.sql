-- What a wine is, past a name and a price.
--
-- A wine in the catalogue is a Recipe like anything else, so it has a title and
-- a price and nothing more: "a Riesling under $90 from the Clare" is a question
-- the register cannot answer. The same wine also appears three times, because
-- each pour size is its own row ("BenMarco Malbec 150mL", "...250mL",
-- "...750mL").
--
-- Wine is the bottle as the printed list describes it; WinePour is each pour
-- size, pointing at the Recipe that carries its price. No price moves: money
-- stays on the Recipe, where the till, the reports and the per-venue overrides
-- already read it.

CREATE TABLE "Wine" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "producer" TEXT NOT NULL,
    -- The bit in quotes on the list: 'Polish Hill', 'Valle de Uco'. Often none.
    "cuvee" TEXT,
    -- As printed: one grape, or the blend spelled out.
    "grape" TEXT,
    "region" TEXT,
    -- A state for Australian wine, a country for imports — SA, VIC, FRA, ITA.
    -- Kept as printed, because that is how the floor says it.
    "origin" TEXT,
    -- NULL = non-vintage.
    "vintage" INTEGER,
    -- The menu's own heading and sub-heading.
    "section" TEXT,
    "styleBand" TEXT,
    -- Printed pairing marks: s = seafood & ceviche, r = rich & grilled,
    -- v = vegetables & cheese.
    "pairsWith" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "tastingNote" TEXT,
    -- The premium by-the-glass tier the list sets apart.
    "sommelierPour" BOOLEAN NOT NULL DEFAULT false,
    -- The list's "**": on hand now, not reliably re-orderable.
    "limitedStock" BOOLEAN NOT NULL DEFAULT false,
    "serveChilled" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WinePour" (
    "id" TEXT NOT NULL,
    "wineId" TEXT NOT NULL,
    -- A POS item is one pour of one wine, never shared.
    "recipeId" TEXT NOT NULL,
    "ml" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WinePour_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Wine_venue_section_sortOrder_idx" ON "Wine"("venue", "section", "sortOrder");
CREATE INDEX "Wine_grape_idx" ON "Wine"("grape");
CREATE INDEX "Wine_region_idx" ON "Wine"("region");
CREATE UNIQUE INDEX "WinePour_recipeId_key" ON "WinePour"("recipeId");
CREATE UNIQUE INDEX "WinePour_wineId_ml_key" ON "WinePour"("wineId", "ml");
CREATE INDEX "WinePour_wineId_idx" ON "WinePour"("wineId");

ALTER TABLE "WinePour" ADD CONSTRAINT "WinePour_wineId_fkey"
    FOREIGN KEY ("wineId") REFERENCES "Wine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WinePour" ADD CONSTRAINT "WinePour_recipeId_fkey"
    FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
