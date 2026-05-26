-- Photo evidence per delivery line (for damaged goods, supplier disputes).
-- Stores a URL pointing to a Cloud Storage object. Optional — most lines
-- won't have a photo.
ALTER TABLE "StockDeliveryCheckItem" ADD COLUMN "photoUrl" TEXT;
