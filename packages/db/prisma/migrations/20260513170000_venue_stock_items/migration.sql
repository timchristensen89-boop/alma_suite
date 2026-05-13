-- Add venue-specific stock controls while keeping StockItem as the shared
-- catalogue. Existing StockItem rows and balances are not rewritten.
CREATE TABLE "VenueStockItem" (
  "id" TEXT NOT NULL,
  "venue" TEXT NOT NULL,
  "stockItemId" TEXT NOT NULL,
  "parLevel" DOUBLE PRECISION,
  "reorderPoint" DOUBLE PRECISION,
  "onHand" DOUBLE PRECISION,
  "unitOverride" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VenueStockItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "VenueStockItem"
  ADD CONSTRAINT "VenueStockItem_stockItemId_fkey"
  FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "VenueStockItem_venue_stockItemId_key" ON "VenueStockItem"("venue", "stockItemId");
CREATE INDEX "VenueStockItem_venue_idx" ON "VenueStockItem"("venue");
CREATE INDEX "VenueStockItem_stockItemId_idx" ON "VenueStockItem"("stockItemId");
CREATE INDEX "VenueStockItem_venue_active_idx" ON "VenueStockItem"("venue", "active");
CREATE INDEX "VenueStockItem_venue_reorderPoint_idx" ON "VenueStockItem"("venue", "reorderPoint");
CREATE INDEX "VenueStockItem_updatedAt_idx" ON "VenueStockItem"("updatedAt");

-- Conservative backfill: create venue rows only where an existing stocktake
-- already ties a catalogue item to a venue. Do not invent venue on-hand values.
INSERT INTO "VenueStockItem" (
  "id",
  "venue",
  "stockItemId",
  "parLevel",
  "reorderPoint",
  "onHand",
  "active",
  "createdAt",
  "updatedAt"
)
SELECT
  'vsi_' || md5(stocktake."venue" || ':' || line."itemId") AS "id",
  stocktake."venue",
  line."itemId",
  item."parLevel",
  item."reorderPoint",
  NULL,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "StocktakeLine" line
INNER JOIN "Stocktake" stocktake ON stocktake."id" = line."stocktakeId"
INNER JOIN "StockItem" item ON item."id" = line."itemId"
WHERE stocktake."venue" IS NOT NULL
  AND stocktake."venue" <> ''
  AND line."itemId" IS NOT NULL
GROUP BY stocktake."venue", line."itemId", item."parLevel", item."reorderPoint"
ON CONFLICT ("venue", "stockItemId") DO NOTHING;
