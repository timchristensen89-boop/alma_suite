-- Capture the dollar value of a transfer at the time it's made (cost attribution).
ALTER TABLE "StockTransfer" ADD COLUMN "valueCents" INTEGER;
