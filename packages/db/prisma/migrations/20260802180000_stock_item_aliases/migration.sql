-- Remembered invoice-line matches.
--
-- Supplier invoice descriptions repeat verbatim month after month. In
-- production the same string recurred up to 13 times, and each occurrence
-- asked a person the same question, because nothing recorded the answer.
--
-- An alias ties a supplier's wording to the item somebody confirmed it means,
-- so the question is asked once.
CREATE TABLE IF NOT EXISTS "stock_item_aliases" (
  "id"          TEXT NOT NULL,
  "aliasKey"    TEXT NOT NULL,
  "supplierId"  TEXT,
  "stockItemId" TEXT NOT NULL,
  "sourceText"  TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stock_item_aliases_pkey" PRIMARY KEY ("id")
);

-- One answer per wording per supplier. NULL supplier means the wording applies
-- whoever sends it; Postgres treats NULLs as distinct in a unique index, which
-- is the behaviour wanted here — a global alias and a supplier-specific one
-- can coexist, and the supplier-specific one is preferred at lookup.
CREATE UNIQUE INDEX IF NOT EXISTS "stock_item_aliases_aliasKey_supplierId_key"
  ON "stock_item_aliases"("aliasKey", "supplierId");
CREATE INDEX IF NOT EXISTS "stock_item_aliases_stockItemId_idx"
  ON "stock_item_aliases"("stockItemId");

ALTER TABLE "stock_item_aliases" ADD CONSTRAINT "stock_item_aliases_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_item_aliases" ADD CONSTRAINT "stock_item_aliases_stockItemId_fkey"
  FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
