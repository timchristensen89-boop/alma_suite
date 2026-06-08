-- Bridge weight/volume recipe lines to count-unit items.
-- e.g. a punnet of mini cucumbers ≈ 250 g; a bunch of radish ≈ 150 g.
ALTER TABLE "StockItem" ADD COLUMN "measurePerCountUnit" DOUBLE PRECISION;
ALTER TABLE "StockItem" ADD COLUMN "measureUnit" TEXT;
