-- Make StocktakeLine.countedQty nullable so a not-yet-counted line (NULL) is
-- distinct from a counted zero. Backward-compatible: existing values are kept;
-- only the NOT NULL constraint is dropped.
ALTER TABLE "StocktakeLine" ALTER COLUMN "countedQty" DROP NOT NULL;
